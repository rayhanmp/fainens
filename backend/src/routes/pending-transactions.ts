import { FastifyInstance } from "fastify";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { auditLogs, pendingTransactions, categories, accounts } from "../db/schema";
import { parseNaturalLanguageTransaction } from "../services/transaction-parser";
import {
  getOrCreateAutoExpenseAccount,
  getOrCreateAutoIncomeAccount,
  insertPreparedJournalEntrySync,
  prepareJournalEntry,
  type JournalLineInput,
  type PreparedJournalEntry,
} from "../services/ledger";
import { PeriodLockedError } from "../services/period-locking";
import { DEFAULT_AGENT_TIMEZONE, normalizeAgentDateString } from "../services/agent-normalization";
import { invalidateOnTransactionMutation } from "../cache";

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

function parseStoredPendingData(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {
      type: "expense",
      amount: 0,
      description: "Needs review",
      category: "Others",
      date: null,
      confidence: 0,
      notes: "Pending data could not be read. Edit this item before approving it.",
    };
  }
}

/** Raised inside the approval transaction when another request won the race. */
class PendingAlreadyProcessedError extends Error {
  constructor() {
    super("Pending transaction already processed");
  }
}

/** Machine-readable code on the 422 sent when the user must pick the wallet. */
export const SOURCE_ACCOUNT_REQUIRED = "source_account_required";

function normalizeAccountName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Resolve the wallet a pending item was paid from (expense) or received into
 * (income). An importer's or the user's explicit account ID wins; otherwise
 * the name must match exactly one active wallet (case/whitespace-insensitive,
 * never a substring, so "BCA" does not pick "BCA Syariah"). With neither, the
 * only wallet is used when exactly one exists. Anything else is refused so the
 * user picks the account instead of the first wallet being charged.
 */
export function resolvePendingSourceWallet<T extends { id: number; name: string }>(
  parsed: { fromAccountId?: unknown; fromAccount?: unknown },
  wallets: T[],
): { wallet: T } | { error: string } {
  const pickAccount = "Edit this pending transaction and choose the account it used before approving.";
  const rawId = parsed.fromAccountId;
  if (rawId != null && rawId !== "") {
    const requestedId = Number(rawId);
    const wallet = Number.isSafeInteger(requestedId) && requestedId > 0
      ? wallets.find((candidate) => candidate.id === requestedId)
      : undefined;
    return wallet ? { wallet } : { error: `The account selected for this pending transaction is not an active wallet. ${pickAccount}` };
  }
  const requestedName = typeof parsed.fromAccount === "string" ? normalizeAccountName(parsed.fromAccount) : "";
  if (requestedName) {
    const matches = wallets.filter((candidate) => normalizeAccountName(candidate.name) === requestedName);
    if (matches.length === 1) return { wallet: matches[0] };
    const label = String(parsed.fromAccount).trim();
    return {
      error: matches.length === 0
        ? `No active wallet is named "${label}". ${pickAccount}`
        : `More than one active wallet is named "${label}". ${pickAccount}`,
    };
  }
  if (wallets.length === 1) return { wallet: wallets[0] };
  return {
    error: wallets.length === 0
      ? "No active wallet account found. Create one before approving this pending transaction."
      : `This pending transaction does not say which account it used. ${pickAccount}`,
  };
}

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
      parsedData: parseStoredPendingData(p.parsedData),
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
      return reply.code(409).send({ error: "Pending transaction already processed" });
    }

    const parsed = parseStoredPendingData(pending.parsedData) as {
      type: string;
      amount: number;
      description: string;
      category: string;
      date?: string | null;
      place?: string | null;
      notes?: string | null;
      memo?: string | null;
      toAccount?: string | null;
      fromAccount?: string | null;
      fromAccountId?: unknown;
      reference?: unknown;
    };

    const parsedValidation = pendingParsedTransactionSchema.safeParse(parsed);
    if (!parsedValidation.success) {
      return reply.code(400).send({ error: "Pending transaction data is incomplete; edit it before approving" });
    }

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
    const kind: "expense" | "income" = parsed.type === "income" ? "income" : "expense";
    const amount = parsed.amount;
    const description = parsed.description.trim();

    // Prefer the account resolved by an importer (or by the user's edit), then
    // an exact unique name. Never guess: an unresolved wallet is the user's call.
    const walletAccounts: Array<{ id: number; name: string; liquidityClass: string | null }> = await db
      .select({ id: accounts.id, name: accounts.name, liquidityClass: accounts.liquidityClass })
      .from(accounts)
      .where(and(eq(accounts.type, "asset"), eq(accounts.isActive, true)));
    const resolvedWallet = resolvePendingSourceWallet(parsed, walletAccounts);
    if ("error" in resolvedWallet) {
      return reply.code(422).send({ error: resolvedWallet.error, code: SOURCE_ACCOUNT_REQUIRED });
    }
    const account = resolvedWallet.wallet;

    // A bare YYYY-MM-DD is a local calendar day; anchor it like the agent path.
    let txDate = Date.now();
    if (typeof parsed.date === "string" && parsed.date.trim()) {
      const normalizedDate = normalizeAgentDateString(parsed.date, DEFAULT_AGENT_TIMEZONE);
      txDate = typeof normalizedDate === "string" ? Date.parse(normalizedDate) : NaN;
      if (!Number.isSafeInteger(txDate) || txDate < 0) {
        return reply.code(400).send({ error: "Parsed transaction date is invalid" });
      }
    }

    let categoryId: number | null = null;
    let categoryExpenseAccountId: number | null = null;
    const categoryName = parsed.category?.trim();
    if (categoryName) {
      const [category] = await db
        .select({ id: categories.id, reportingAccountId: categories.reportingAccountId })
        .from(categories)
        .where(and(eq(sql`lower(${categories.name})`, categoryName.toLowerCase()), eq(categories.isActive, true)))
        .limit(1);
      categoryId = category?.id ?? null;
      if (kind === "expense" && category?.reportingAccountId != null) {
        const [reportingAccount] = await db
          .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
          .from(accounts)
          .where(eq(accounts.id, category.reportingAccountId))
          .limit(1);
        if (!reportingAccount || !reportingAccount.isActive || reportingAccount.type !== "expense") {
          return reply.code(422).send({ error: "Category reporting account must be an active expense account" });
        }
        categoryExpenseAccountId = reportingAccount.id;
      }
    }

    const walletCashFlowClass = account.liquidityClass === "cash_equivalent" ? "operating" as const : null;
    const lines: JournalLineInput[] = kind === "expense"
      ? [
          { accountId: categoryExpenseAccountId ?? (await getOrCreateAutoExpenseAccount(db)).id, debit: amount, credit: 0, description },
          { accountId: account.id, debit: 0, credit: amount, description, cashFlowClass: walletCashFlowClass },
        ]
      : [
          { accountId: account.id, debit: amount, credit: 0, description, cashFlowClass: walletCashFlowClass },
          { accountId: (await getOrCreateAutoIncomeAccount(db)).id, debit: 0, credit: amount, description },
        ];

    // The canonical ledger path validates balance, active accounts, the
    // closed-period lock and category allocations before anything is written.
    let prepared: PreparedJournalEntry;
    try {
      prepared = await prepareJournalEntry({
        date: txDate,
        description,
        reference: typeof parsed.reference === "string" && parsed.reference.trim() ? parsed.reference.trim() : null,
        notes: parsed.notes || parsed.memo || null,
        place: parsed.place || null,
        txType: `simple_${kind}`,
        categoryId,
        categoryAllocations: kind === "expense" && categoryId != null ? [{ categoryId, amount }] : undefined,
        lines,
      }, db);
    } catch (error) {
      if (error instanceof PeriodLockedError) return reply.code(409).send({ error: error.message });
      return reply.code(422).send({ error: error instanceof Error ? error.message : "Pending transaction failed ledger validation" });
    }

    let transactionId: number;
    try {
      transactionId = db.transaction((tx) => {
        // Re-check inside the write transaction so a double click (or a
        // concurrent agent approval) cannot post the same item twice.
        const fresh = tx
          .select({ status: pendingTransactions.status })
          .from(pendingTransactions)
          .where(eq(pendingTransactions.id, pendingId))
          .limit(1)
          .all()[0];
        if (!fresh || fresh.status !== "pending") throw new PendingAlreadyProcessedError();

        const insertedId = insertPreparedJournalEntrySync(tx, prepared);
        const approved = tx.update(pendingTransactions)
          .set({ status: "approved", updatedAt: new Date() })
          .where(and(eq(pendingTransactions.id, pendingId), eq(pendingTransactions.status, "pending")))
          .returning({ id: pendingTransactions.id })
          .all()[0];
        if (!approved) throw new PendingAlreadyProcessedError();
        tx.insert(auditLogs).values({
          entityType: "pending_transaction",
          entityId: pendingId,
          action: "approve",
          afterSnapshot: Buffer.from(JSON.stringify({ source: "pending_approval", status: "approved", transactionId: insertedId })),
        }).run();
        return insertedId;
      }, { behavior: "immediate" });
    } catch (error) {
      if (error instanceof PendingAlreadyProcessedError || error instanceof PeriodLockedError
        || (error instanceof Error && error.message === "Journal period changed while posting; retry")) {
        return reply.code(409).send({ error: error.message });
      }
      fastify.log.error(error);
      return reply.code(500).send({ error: "Failed to approve pending transaction" });
    }
    await invalidateOnTransactionMutation({
      transactionId,
      affectedAccountIds: prepared.accountIds,
      affectedPeriodIds: prepared.periodId == null ? undefined : [prepared.periodId],
      revisionBumped: true,
    });

    return {
      success: true,
      transactionId,
      message: `Transaction created: ${formatCurrency(amount)} ${description}`,
    };
  });

  // Reject pending transaction. Approved items already have a ledger posting,
  // so rejecting them would hide a real transaction behind a "rejected" label.
  fastify.post("/api/pending-transactions/:id/reject", {
    schema: { operationId: "rejectPendingTransaction", tags: ["pending-transactions"], params: pendingIdParamsSchema, response: { 200: pendingSuccessResponseSchema, 404: pendingErrorSchema, 409: pendingErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const pendingId = parseInt(id, 10);

    const [pending] = await db
      .select({ id: pendingTransactions.id, status: pendingTransactions.status })
      .from(pendingTransactions)
      .where(eq(pendingTransactions.id, pendingId))
      .limit(1);

    if (!pending) {
      return reply.code(404).send({ error: "Pending transaction not found" });
    }
    if (pending.status === "rejected") return { success: true as const };
    if (pending.status === "approved") {
      return reply.code(409).send({ error: "Pending transaction is already approved; reverse the posted transaction instead" });
    }

    // Conditional update: an approval that lands between the read and this
    // write must win, not be relabelled as rejected.
    const [rejected] = await db
      .update(pendingTransactions)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(and(eq(pendingTransactions.id, pendingId), inArray(pendingTransactions.status, ["pending", "failed"])))
      .returning({ id: pendingTransactions.id });
    if (!rejected) {
      return reply.code(409).send({ error: "Pending transaction already processed" });
    }

    return { success: true as const };
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
      parsedData: parseStoredPendingData(pending.parsedData),
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

  // Retry parsing a failed (or still pending) item. Approved and rejected
  // rows are final: re-opening them would allow a second ledger posting.
  fastify.post("/api/pending-transactions/:id/retry", {
    schema: { operationId: "retryPendingTransaction", tags: ["pending-transactions"], params: pendingIdParamsSchema, response: { 200: pendingRetryResponseSchema, 404: pendingErrorSchema, 409: pendingErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const pendingId = parseInt(id, 10);

    const [pending] = await db
      .select()
      .from(pendingTransactions)
      .where(eq(pendingTransactions.id, pendingId))
      .limit(1);

    if (!pending) {
      return reply.code(404).send({ error: "Pending transaction not found" });
    }
    if (pending.status !== "pending" && pending.status !== "failed") {
      return reply.code(409).send({ error: `Pending transaction is already ${pending.status}; it cannot be re-parsed` });
    }
    // Structured importers (e.g. the wondr/BNI Gmail parser) already captured
    // the exact account and bank reference; an LLM re-parse would discard them.
    if (pending.source.startsWith("gmail:")) {
      return reply.code(409).send({ error: "Imported bank notifications are not re-parsed; edit the pending transaction instead" });
    }

    const previous = parseStoredPendingData(pending.parsedData) as Record<string, unknown>;
    const reparsed = await parseNaturalLanguageTransaction(pending.rawMessage);
    const newAttempts = pending.parseAttempts + 1;
    // The LLM call is slow; only write if nobody approved/rejected meanwhile.
    const stillRetryable = and(eq(pendingTransactions.id, pendingId), inArray(pendingTransactions.status, ["pending", "failed"]));

    if (reparsed.confidence > 0) {
      // Keep account/reference choices the user (or an importer) already made.
      const preserved = Object.fromEntries(
        ["fromAccountId", "fromAccount", "toAccount", "reference"]
          .filter((key) => previous[key] != null && previous[key] !== "")
          .map((key) => [key, previous[key]]),
      );
      const parsed = { ...reparsed, ...preserved };
      const [updated] = await db
        .update(pendingTransactions)
        .set({
          parsedData: JSON.stringify(parsed),
          status: "pending",
          parseAttempts: newAttempts,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(stillRetryable)
        .returning({ id: pendingTransactions.id });
      if (!updated) return reply.code(409).send({ error: "Pending transaction already processed" });

      return { success: true, parsed };
    } else {
      const [updated] = await db
        .update(pendingTransactions)
        .set({
          parseAttempts: newAttempts,
          lastError: "Retry failed",
          status: newAttempts >= MAX_PARSE_ATTEMPTS ? "failed" : pending.status,
          updatedAt: new Date(),
        })
        .where(stillRetryable)
        .returning({ id: pendingTransactions.id });
      if (!updated) return reply.code(409).send({ error: "Pending transaction already processed" });

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
