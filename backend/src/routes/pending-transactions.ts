import { FastifyInstance } from "fastify";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { auditLogs, pendingTransactions, transactions, transactionLines, categories, accounts } from "../db/schema";
import { parseNaturalLanguageTransaction } from "../services/transaction-parser";
import { getOrCreateAutoExpenseAccount, getOrCreateAutoIncomeAccount } from "../services/ledger";
import { findPeriodIdForDate } from "../services/transaction-mutations";
import { invalidateOnTransactionMutation } from "../cache";
import { bumpFinancialRevisionSync } from "../services/financial-revision";

const MAX_PARSE_ATTEMPTS = 3;
const pendingErrorSchema = z.object({ error: z.string() }).passthrough();
const pendingIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const pendingTimestampSchema = z.union([z.date(), z.string(), z.number()]);
const pendingRecordSchema = z.object({ id: z.number().int(), rawMessage: z.string(), parsedData: z.unknown(), status: z.enum(["pending", "approved", "rejected", "failed"]), parseAttempts: z.number().int().nonnegative(), lastError: z.string().nullable(), source: z.string().optional(), userMessageId: z.string().nullable().optional(), createdAt: pendingTimestampSchema, updatedAt: pendingTimestampSchema.optional() }).passthrough();
const pendingListItemSchema = pendingRecordSchema.omit({ updatedAt: true }).passthrough();
const pendingParseBodySchema = z.object({ message: z.string().trim().min(1).max(4000), userMessageId: z.string().max(200).optional(), source: z.string().max(80).optional() }).passthrough();
const pendingParsedTransactionSchema = z.object({
  type: z.enum(["expense", "income", "transfer"]),
  amount: z.number().int().nonnegative(),
  description: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(200),
  date: z.string().max(40).nullable().optional(),
  place: z.string().max(300).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  memo: z.string().max(2000).nullable().optional(),
  fromAccount: z.string().max(200).nullable().optional(),
  toAccount: z.string().max(200).nullable().optional(),
  confidence: z.number().min(0).max(1),
}).passthrough();
const pendingCreateBodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  parsed: pendingParsedTransactionSchema,
  userMessageId: z.string().max(200).optional(),
  source: z.string().max(80).optional(),
}).passthrough();
const pendingUpdateBodySchema = z.object({ parsed: pendingParsedTransactionSchema }).passthrough();
const pendingParseResponseSchema = z.object({ pendingId: z.number().int(), parsed: z.unknown(), message: z.string().optional(), error: z.string().optional() }).passthrough();
const pendingApproveResponseSchema = z.object({ success: z.literal(true), transactionId: z.number().int(), message: z.string() }).passthrough();
const pendingSuccessResponseSchema = z.object({ success: z.literal(true) }).passthrough();
const pendingRetryResponseSchema = z.object({ success: z.boolean(), parsed: z.unknown().optional(), error: z.string().optional() }).passthrough();

export default async function pendingRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);
  // List all pending transactions
  fastify.get("/api/pending-transactions", {
    schema: { operationId: "listPendingTransactions", tags: ["pending-transactions"], response: { 200: z.array(pendingListItemSchema) } },
  }, async (request, reply) => {
    const pending = await db
      .select()
      .from(pendingTransactions)
      .where(eq(pendingTransactions.status, "pending"))
      .orderBy(desc(pendingTransactions.createdAt));

    return pending.map((p) => ({
      id: p.id,
      rawMessage: p.rawMessage,
      parsedData: JSON.parse(p.parsedData),
      status: p.status,
      parseAttempts: p.parseAttempts,
      lastError: p.lastError,
      createdAt: p.createdAt,
    }));
  });

  // Persist a user-confirmed parse from the web editor. This is deliberately
  // separate from the LLM parse endpoint so edited fields are not overwritten
  // by a second model call before the user approves them.
  fastify.post("/api/pending-transactions", {
    schema: { operationId: "createPendingTransaction", tags: ["pending-transactions"], body: pendingCreateBodySchema, response: { 201: z.object({ pendingId: z.number().int() }), 400: pendingErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as {
      message: string;
      parsed: z.infer<typeof pendingParsedTransactionSchema>;
      userMessageId?: string;
      source?: string;
    };
    const parsed = {
      ...body.parsed,
      notes: body.parsed.notes ?? body.parsed.memo ?? undefined,
    };
    const [created] = await db.insert(pendingTransactions).values({
      rawMessage: body.message,
      parsedData: JSON.stringify(parsed),
      status: "pending",
      parseAttempts: 1,
      lastError: null,
      userMessageId: body.userMessageId ?? null,
      source: body.source ?? "web",
    }).returning({ id: pendingTransactions.id });
    if (!created) return reply.code(400).send({ error: "Failed to save pending transaction" });
    return reply.code(201).send({ pendingId: created.id });
  });

  // Parse a message and create pending transaction
  fastify.post("/api/pending-transactions/parse", {
    schema: { operationId: "parsePendingTransaction", tags: ["pending-transactions"], body: pendingParseBodySchema, response: { 200: pendingParseResponseSchema, 400: pendingErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as {
      message: string;
      userMessageId?: string;
      source?: string;
    };

    if (!body.message) {
      return reply.code(400).send({ error: "Message is required" });
    }

    // Try parsing with LLM
    let parsed = await parseNaturalLanguageTransaction(body.message);
    let attempts = 1;
    let errorMsg: string | null = null;

    // Retry if parsing failed
    while (parsed.confidence === 0 && attempts < MAX_PARSE_ATTEMPTS) {
      parsed = await parseNaturalLanguageTransaction(body.message);
      attempts++;
    }

    if (parsed.confidence === 0) {
      errorMsg = "Failed to parse after multiple attempts";
    }

    // Create pending transaction
    const [created] = await db
      .insert(pendingTransactions)
      .values({
        rawMessage: body.message,
        parsedData: JSON.stringify(parsed),
        status: parsed.confidence > 0 ? "pending" : "failed",
        parseAttempts: attempts,
        lastError: errorMsg,
        userMessageId: body.userMessageId || null,
        source: body.source || "whatsapp",
      })
      .returning();

    // If parsing succeeded, return success message for WhatsApp
    if (parsed.confidence > 0) {
      return {
        pendingId: created.id,
        parsed,
        message: `Parsed: ${parsed.type} - ${formatCurrency(parsed.amount)} for "${parsed.description}" (${parsed.category}). Reply YES to confirm or NO to cancel.`,
      };
    } else {
      return {
        pendingId: created.id,
        parsed,
        error: "Failed to parse transaction",
      };
    }
  });

  // Approve pending transaction - creates actual transaction
  fastify.post("/api/pending-transactions/:id/approve", {
    schema: { operationId: "approvePendingTransaction", tags: ["pending-transactions"], params: pendingIdParamsSchema, response: { 200: pendingApproveResponseSchema, 400: pendingErrorSchema, 404: pendingErrorSchema, 409: pendingErrorSchema, 422: pendingErrorSchema, 500: pendingErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const pendingId = parseInt(id, 10);
    if (!Number.isInteger(pendingId) || pendingId <= 0) {
      return reply.code(400).send({ error: "Invalid pending transaction ID" });
    }

    const [pending] = await db
      .select()
      .from(pendingTransactions)
      .where(eq(pendingTransactions.id, pendingId))
      .limit(1);

    if (!pending) {
      return reply.code(404).send({ error: "Pending transaction not found" });
    }

    if (pending.status !== "pending") {
      return reply.code(400).send({ error: "Pending transaction already processed" });
    }

    const parsed = JSON.parse(pending.parsedData) as {
      type: string;
      amount: number;
      description: string;
      category: string;
      date?: string;
      place?: string;
      notes?: string;
      toAccount?: string;
    };

    // Find category by name
    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.name, parsed.category))
      .limit(1);

    if (!Number.isSafeInteger(parsed.amount) || parsed.amount <= 0) {
      return reply.code(400).send({ error: "Parsed amount must be a positive integer rupiah value" });
    }
    if (!parsed.description?.trim()) {
      return reply.code(400).send({ error: "Parsed description is required" });
    }
    if (parsed.type === "transfer") {
      return reply.code(422).send({
        error: "Transfer approval requires explicit source and destination account IDs",
      });
    }

    // Find default active wallet account
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.type, "asset"), eq(accounts.isActive, true)))
      .limit(1);

    if (!account) {
      return reply.code(400).send({ error: "No wallet account found" });
    }

    const txDate = parsed.date ? new Date(parsed.date).getTime() : Date.now();
    if (!Number.isFinite(txDate)) {
      return reply.code(400).send({ error: "Parsed transaction date is invalid" });
    }
    const periodId = await findPeriodIdForDate(txDate);

    // Determine transaction kind based on type
    let kind: "expense" | "income" = "expense";
    if (parsed.type === "income") kind = "income";

    const counterparty = kind === "expense"
      ? await getOrCreateAutoExpenseAccount(db)
      : await getOrCreateAutoIncomeAccount(db);
    let transactionId: number;
    try {
      transactionId = db.transaction((tx) => {
      const fresh = tx
        .select({ status: pendingTransactions.status })
        .from(pendingTransactions)
        .where(eq(pendingTransactions.id, pendingId))
        .limit(1)
        .all()[0];
      if (!fresh) throw new Error("Pending transaction not found");
      if (fresh.status !== "pending") throw new Error("Pending transaction already processed");

      const inserted = tx
        .insert(transactions)
        .values({
          date: new Date(txDate),
          description: parsed.description.trim(),
          notes: parsed.notes || null,
          place: parsed.place || null,
          txType: `simple_${kind}`,
          periodId,
          categoryId: category?.id ?? null,
        })
        .returning({ id: transactions.id })
        .all()[0];
      if (!inserted) throw new Error("Failed to create approved transaction");
      const lines = kind === "expense"
        ? [
            { transactionId: inserted.id, accountId: counterparty.id, debit: parsed.amount, credit: 0 },
            { transactionId: inserted.id, accountId: account.id, debit: 0, credit: parsed.amount, cashFlowClass: account.liquidityClass === "cash_equivalent" ? "operating" : null },
          ]
        : [
            { transactionId: inserted.id, accountId: account.id, debit: parsed.amount, credit: 0, cashFlowClass: account.liquidityClass === "cash_equivalent" ? "operating" : null },
            { transactionId: inserted.id, accountId: counterparty.id, debit: 0, credit: parsed.amount },
          ];
      tx.insert(transactionLines).values(lines).run();
      tx.update(pendingTransactions)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(pendingTransactions.id, pendingId))
        .run();
      tx.insert(auditLogs).values({
        entityType: "transaction",
        entityId: inserted.id,
        action: "create",
        afterSnapshot: Buffer.from(JSON.stringify({ source: "pending_approval", pendingId, lines })),
      }).run();
      bumpFinancialRevisionSync(tx);
        return inserted.id;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Pending transaction already processed") {
        return reply.code(409).send({ error: error.message });
      }
      fastify.log.error(error);
      return reply.code(500).send({ error: "Failed to approve pending transaction" });
    }
    await invalidateOnTransactionMutation({
      transactionId,
      affectedAccountIds: [account.id, counterparty.id],
      affectedPeriodIds: periodId == null ? undefined : [periodId],
      revisionBumped: true,
    });

    return {
      success: true,
      transactionId,
      message: `Transaction created: ${formatCurrency(parsed.amount)} ${parsed.description}`,
    };
  });

  // Reject pending transaction
  fastify.post("/api/pending-transactions/:id/reject", {
    schema: { operationId: "rejectPendingTransaction", tags: ["pending-transactions"], params: pendingIdParamsSchema, response: { 200: pendingSuccessResponseSchema, 404: pendingErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const pendingId = parseInt(id);

    const [pending] = await db
      .select()
      .from(pendingTransactions)
      .where(eq(pendingTransactions.id, pendingId))
      .limit(1);

    if (!pending) {
      return reply.code(404).send({ error: "Pending transaction not found" });
    }

    await db
      .update(pendingTransactions)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(pendingTransactions.id, pendingId));

    return { success: true };
  });

  // Get single pending transaction
  fastify.get("/api/pending-transactions/:id", {
    schema: { operationId: "getPendingTransaction", tags: ["pending-transactions"], params: pendingIdParamsSchema, response: { 200: pendingRecordSchema, 404: pendingErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const pendingId = parseInt(id);

    const [pending] = await db
      .select()
      .from(pendingTransactions)
      .where(eq(pendingTransactions.id, pendingId))
      .limit(1);

    if (!pending) {
      return reply.code(404).send({ error: "Pending transaction not found" });
    }

    return {
      id: pending.id,
      rawMessage: pending.rawMessage,
      parsedData: JSON.parse(pending.parsedData),
      status: pending.status,
      parseAttempts: pending.parseAttempts,
      lastError: pending.lastError,
      source: pending.source,
      createdAt: pending.createdAt,
    };
  });

  // Update only the editable parsed fields. Pending rows are the sole mutable
  // state here; approved/rejected records remain an audit trail.
  fastify.put("/api/pending-transactions/:id", {
    schema: { operationId: "updatePendingTransaction", tags: ["pending-transactions"], params: pendingIdParamsSchema, body: pendingUpdateBodySchema, response: { 200: pendingSuccessResponseSchema, 400: pendingErrorSchema, 404: pendingErrorSchema, 409: pendingErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const pendingId = parseInt(id, 10);
    const body = request.body as { parsed: z.infer<typeof pendingParsedTransactionSchema> };
    const [pending] = await db.select({ id: pendingTransactions.id, status: pendingTransactions.status })
      .from(pendingTransactions)
      .where(eq(pendingTransactions.id, pendingId))
      .limit(1);
    if (!pending) return reply.code(404).send({ error: "Pending transaction not found" });
    if (pending.status !== "pending") return reply.code(409).send({ error: "Pending transaction already processed" });
    const parsed = {
      ...body.parsed,
      notes: body.parsed.notes ?? body.parsed.memo ?? undefined,
    };
    await db.update(pendingTransactions)
      .set({ parsedData: JSON.stringify(parsed), updatedAt: new Date(), lastError: null })
      .where(eq(pendingTransactions.id, pendingId));
    return { success: true as const };
  });

  // Retry parsing a failed pending transaction
  fastify.post("/api/pending-transactions/:id/retry", {
    schema: { operationId: "retryPendingTransaction", tags: ["pending-transactions"], params: pendingIdParamsSchema, response: { 200: pendingRetryResponseSchema, 404: pendingErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const pendingId = parseInt(id);

    const [pending] = await db
      .select()
      .from(pendingTransactions)
      .where(eq(pendingTransactions.id, pendingId))
      .limit(1);

    if (!pending) {
      return reply.code(404).send({ error: "Pending transaction not found" });
    }

    // Try parsing again
    const parsed = await parseNaturalLanguageTransaction(pending.rawMessage);
    const newAttempts = pending.parseAttempts + 1;

    if (parsed.confidence > 0) {
      await db
        .update(pendingTransactions)
        .set({
          parsedData: JSON.stringify(parsed),
          status: "pending",
          parseAttempts: newAttempts,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(pendingTransactions.id, pendingId));

      return { success: true, parsed };
    } else {
      await db
        .update(pendingTransactions)
        .set({
          parseAttempts: newAttempts,
          lastError: "Retry failed",
          status: newAttempts >= MAX_PARSE_ATTEMPTS ? "failed" : "pending",
          updatedAt: new Date(),
        })
        .where(eq(pendingTransactions.id, pendingId));

      return { success: false, error: "Still unable to parse" };
    }
  });
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}
