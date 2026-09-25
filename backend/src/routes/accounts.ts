import { eq, like, desc, and, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { accounts, auditLogs, budgetPlans, categories, reconciliationItems, reconciliationSessions, transactionLines, transactions } from "../db/schema";
import { computeAccountBalance, computeAccountBalanceRolledUp, insertPreparedJournalEntrySync } from "../services/ledger";
import { precomputeAccountBalance } from "../cache/precompute";
import { calculateReconciliationItem } from "../services/reconciliation";
import { prepareBalanceAdjustmentJournal } from "../services/balance-adjustments";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { bumpFinancialRevisionSync } from "../services/financial-revision";
import { createRecoveryReconciliation } from "../services/recovery-reconciliation";

const accountTypeEnum = ["asset", "liability", "equity", "revenue", "expense"] as const;
const liquidityClassEnum = ["cash_equivalent", "receivable", "investment", "non_cash"] as const;

const accountIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const accountListQuerySchema = z.object({
  type: z.enum(accountTypeEnum).optional(),
  search: z.string().max(100).optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
  includeChildren: z.enum(["true", "false"]).optional(),
});
const accountBodySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(accountTypeEnum),
  icon: z.string().max(20).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
  description: z.string().max(500).nullable().optional(),
  accountNumber: z.string().max(100).nullable().optional(),
  creditLimit: z.coerce.number().nonnegative().nullable().optional(),
  interestRate: z.coerce.number().nonnegative().nullable().optional(),
  billingDate: z.coerce.number().int().min(1).max(31).nullable().optional(),
  provider: z.string().max(100).nullable().optional(),
  parentId: z.coerce.number().int().positive().nullable().optional(),
  liquidityClass: z.enum(liquidityClassEnum).optional(),
}).passthrough();
const accountUpdateBodySchema = accountBodySchema.partial().passthrough();
const accountRecordSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.enum(accountTypeEnum),
  balance: z.number().optional(),
}).passthrough();
const accountErrorSchema = z.object({ error: z.string() }).passthrough();
const accountListResponse = { 200: z.array(accountRecordSchema), 400: accountErrorSchema };
const accountRecordResponse = { 200: accountRecordSchema, 400: accountErrorSchema, 404: accountErrorSchema };
const accountCreateResponse = { 201: accountRecordSchema, 400: accountErrorSchema, 409: accountErrorSchema, 500: accountErrorSchema };
const accountUpdateResponse = { 200: accountRecordSchema, 400: accountErrorSchema, 404: accountErrorSchema, 409: accountErrorSchema, 500: accountErrorSchema };
const accountDeleteResponse = { 204: z.void(), 400: accountErrorSchema, 404: accountErrorSchema, 409: accountErrorSchema };
const accountDependencyPreviewSchema = z.object({
  account: accountRecordSchema,
  canArchive: z.boolean(),
  canRestore: z.boolean(),
  blockers: z.array(z.string()),
  dependencies: z.object({
    postedTransactions: z.number().int(),
    budgetPlans: z.number().int(),
    childAccounts: z.number().int(),
    linkedCategories: z.number().int(),
  }).passthrough(),
  consequence: z.string(),
}).passthrough();
const reconciliationSessionSchema = z.object({
  id: z.number().int(),
  asOfDate: z.union([z.date(), z.string(), z.number()]),
  status: z.enum(["reconciled", "adjusted", "needs_classification", "recovered"]),
  lifecycleStatus: z.enum(["active", "voided"]),
  voidedAt: z.union([z.date(), z.string(), z.number()]).nullable().optional(),
  voidReason: z.string().nullable().optional(),
  kind: z.enum(["control", "recovery", "adjustment", "opening_balance"]),
  note: z.string().nullable().optional(),
  createdAt: z.union([z.date(), z.string(), z.number()]),
}).passthrough();
const reconciliationItemSchema = z.object({
  id: z.number().int().optional(),
  sessionId: z.number().int().optional(),
  accountId: z.number().int(),
  accountName: z.string(),
  ledgerBalance: z.number(),
  actualBalance: z.number(),
  difference: z.number(),
  status: z.enum(["matched", "adjusted", "needs_classification"]),
  correctionTransactionId: z.number().int().nullable().optional(),
}).passthrough();
const reconciliationHistorySchema = z.object({
  sessions: z.array(reconciliationSessionSchema.extend({ items: z.array(reconciliationItemSchema) })),
}).passthrough();
const reconciliationBodySchema = z.object({
  balances: z.array(z.object({ accountId: z.number().int().positive(), actualBalance: z.number().int() }).passthrough()).min(1),
  asOfDate: z.number().int().nonnegative().optional(),
  confirmed: z.boolean().optional(),
  note: z.string().max(1000).nullable().optional(),
}).passthrough();
const reconciliationResultSchema = z.object({
  success: z.boolean(),
  requiresClassification: z.boolean(),
  session: reconciliationSessionSchema,
  results: z.array(reconciliationItemSchema),
  adjustmentTransactionId: z.number().int().nullable().optional(),
  message: z.string(),
}).passthrough();
const openingBalanceBodySchema = z.object({
  balance: z.number().int().positive(),
  asOfDate: z.number().int().nonnegative().optional(),
  note: z.string().max(1000).nullable().optional(),
}).passthrough();
const openingBalanceResultSchema = z.object({
  success: z.literal(true),
  accountId: z.number().int(),
  balance: z.number().int(),
  transactionId: z.number().int(),
  session: reconciliationSessionSchema,
  message: z.string(),
}).passthrough();
const recoveryBodySchema = reconciliationBodySchema.extend({
  acknowledgement: z.string().optional(),
  note: z.string().nullable().optional(),
  confirmed: z.literal(true),
});
const recoveryResultSchema = z.object({
  success: z.literal(true),
  session: reconciliationSessionSchema,
  results: z.array(reconciliationItemSchema),
  recoveryTransactionId: z.number().int().nullable(),
  message: z.string(),
}).passthrough();
const reconciliationErrorSchema = z.object({ error: z.string() }).passthrough();

// Sanitize search input to prevent SQL injection
function sanitizeSearchInput(input: string): string {
  // Remove SQL special characters that could be used for injection
  return input.replace(/[%_\[\]]/g, '');
}

function calculateReconciliationItemsSync(
  executor: any,
  balances: Array<{ accountId: number; actualBalance: number }>,
  accountRows: Array<{ id: number; name: string; type: string; liquidityClass?: string }>,
  asOfDate: number,
) {
  return balances.map((item) => {
    const account = accountRows.find((row) => row.id === item.accountId)!;
    const sums = executor
      .select({
        debit: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
        credit: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
      })
      .from(transactionLines)
      .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
      .where(and(
        eq(transactionLines.accountId, item.accountId),
        sql`${transactions.date} <= ${asOfDate}`,
        sql`${transactions.status} <> 'draft'`,
      ))
      .all()[0];
    const calculated = calculateReconciliationItem({
      accountType: account.type as "asset" | "liability",
      debit: Number(sums?.debit ?? 0),
      credit: Number(sums?.credit ?? 0),
      actualBalance: item.actualBalance,
    });
    return {
      accountId: item.accountId,
      accountName: account.name,
      accountType: account.type as "asset" | "liability",
      liquidityClass: account.liquidityClass ?? "non_cash",
      ledgerBalance: calculated.ledgerBalance,
      actualBalance: item.actualBalance,
      difference: calculated.difference,
      status: calculated.status,
    };
  });
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/accounts", {
    schema: { operationId: "listAccounts", tags: ["accounts"], querystring: accountListQuerySchema, response: accountListResponse },
  }, async (request) => {
    const { type, search, includeInactive } = request.query as {
      type?: string;
      search?: string;
      includeInactive?: string;
    };

    // The reimbursement control account remains part of net worth and reports,
    // but users operate claims rather than posting directly to that account.
    const conditions = [or(isNull(accounts.systemKey), ne(accounts.systemKey, "reimbursements-receivable"))];
    if (includeInactive !== "true") conditions.push(eq(accounts.isActive, true));
    if (type && accountTypeEnum.includes(type as (typeof accountTypeEnum)[number])) {
      conditions.push(eq(accounts.type, type));
    }
    if (search) {
      const sanitized = sanitizeSearchInput(search);
      if (sanitized) {
        conditions.push(like(accounts.name, `%${sanitized}%`));
      }
    }

    const allAccounts =
      conditions.length > 0
        ? await db
            .select()
            .from(accounts)
            .where(and(...conditions))
            .orderBy(desc(accounts.sortOrder), accounts.name)
        : await db.select().from(accounts).orderBy(desc(accounts.sortOrder), accounts.name);

    const accountsWithBalances = await Promise.all(
      allAccounts.map(async (account) => {
        const balance = await computeAccountBalance(account.id, db);
        return {
          ...account,
          balance,
        };
      }),
    );

    return accountsWithBalances;
  });

  fastify.get("/api/accounts/:id", {
    schema: { operationId: "getAccount", tags: ["accounts"], params: accountIdParamsSchema, querystring: accountListQuerySchema, response: accountRecordResponse },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const includeChildren = (request.query as { includeChildren?: string }).includeChildren === "true";

    const [account] = await db.select().from(accounts).where(eq(accounts.id, parseInt(id))).limit(1);

    if (!account) {
      reply.code(404).send({ error: "Account not found" });
      return;
    }

    const balance = includeChildren
      ? await computeAccountBalanceRolledUp(account.id, db)
      : await computeAccountBalance(account.id, db);

    return {
      ...account,
      balance,
    };
  });

  fastify.post("/api/accounts", {
    schema: { operationId: "createAccount", tags: ["accounts"], body: accountBodySchema, response: accountCreateResponse },
  }, async (request, reply) => {
    const body = request.body as {
      name: string;
      type: (typeof accountTypeEnum)[number];
      icon?: string | null;
      color?: string | null;
      sortOrder?: number;
      description?: string | null;
      accountNumber?: string | null;
      creditLimit?: number | null;
      interestRate?: number | null;
      billingDate?: number | null;
      provider?: string | null;
      parentId?: number | null;
      liquidityClass?: (typeof liquidityClassEnum)[number];
    };

    if (!body.name?.trim()) {
      reply.code(400).send({ error: "name is required" });
      return;
    }

    if (!accountTypeEnum.includes(body.type)) {
      reply
        .code(400)
        .send({ error: `Invalid account type. Must be one of: ${accountTypeEnum.join(", ")}` });
      return;
    }
    const liquidityClass = body.liquidityClass ?? (body.type === "asset" ? "cash_equivalent" : "non_cash");
    if (!liquidityClassEnum.includes(liquidityClass) || (body.type !== "asset" && liquidityClass !== "non_cash")) {
      return reply.code(400).send({ error: "Only asset accounts may be cash_equivalent, receivable, or investment" });
    }

    // Validate liability-specific fields
    if (body.type === "liability") {
      if (body.creditLimit !== undefined && (typeof body.creditLimit !== "number" || body.creditLimit < 0)) {
        reply.code(400).send({ error: "creditLimit must be a non-negative number" });
        return;
      }
      if (body.interestRate !== undefined && (typeof body.interestRate !== "number" || body.interestRate < 0)) {
        reply.code(400).send({ error: "interestRate must be a non-negative number" });
        return;
      }
      if (body.billingDate !== undefined && (typeof body.billingDate !== "number" || body.billingDate < 1 || body.billingDate > 31)) {
        reply.code(400).send({ error: "billingDate must be between 1 and 31" });
        return;
      }
    }

    const account = db.transaction((tx) => {
      const inserted = (tx.insert(accounts).values({
        name: body.name.trim(),
        type: body.type,
        icon: body.icon ?? null,
        color: body.color ?? null,
        sortOrder: body.sortOrder ?? 0,
        isActive: true,
        description: body.description ?? null,
        accountNumber: body.accountNumber ?? null,
        creditLimit: body.creditLimit ?? null,
        interestRate: body.interestRate ?? null,
        billingDate: body.billingDate ?? null,
        provider: body.provider ?? null,
        parentId: body.parentId ?? null,
        liquidityClass,
      }).returning().all() as any[])[0];
      if (!inserted) throw new Error("Failed to create account");
      bumpFinancialRevisionSync(tx);
      return inserted;
    });

    reply.code(201).send(account);
  });

  fastify.patch("/api/accounts/:id", {
    schema: { operationId: "updateAccount", tags: ["accounts"], params: accountIdParamsSchema, body: accountUpdateBodySchema, response: accountUpdateResponse },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      type: (typeof accountTypeEnum)[number];
      icon: string | null;
      color: string | null;
      sortOrder: number;
      isActive: boolean;
      description: string | null;
      accountNumber: string | null;
      creditLimit: number | null;
      interestRate: number | null;
      billingDate: number | null;
      provider: string | null;
      parentId: number | null;
      liquidityClass: (typeof liquidityClassEnum)[number];
    }>;

    const [existing] = await db.select().from(accounts).where(eq(accounts.id, parseInt(id))).limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Account not found" });
      return;
    }

    if (body.type !== undefined && !accountTypeEnum.includes(body.type)) {
      reply.code(400).send({ error: `Invalid account type. Must be one of: ${accountTypeEnum.join(", ")}` });
      return;
    }
    const nextType = body.type ?? existing.type;
    const nextLiquidityClass = body.liquidityClass ?? existing.liquidityClass;
    if (!liquidityClassEnum.includes(nextLiquidityClass as any) || (nextType !== "asset" && nextLiquidityClass !== "non_cash")) {
      return reply.code(400).send({ error: "Only asset accounts may be cash_equivalent, receivable, or investment" });
    }
    if (body.name !== undefined && !body.name.trim()) {
      reply.code(400).send({ error: "name cannot be empty" });
      return;
    }
    if (body.type !== undefined && body.type !== existing.type) {
      const [historicalLine] = await db
        .select({ id: transactionLines.id })
        .from(transactionLines)
        .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
        .where(and(
          eq(transactionLines.accountId, parseInt(id)),
          sql`${transactions.status} <> 'draft'`,
        ))
        .limit(1);
      if (historicalLine) {
        return reply.code(409).send({ error: "Account type cannot change after posted journal history exists; archive it and create a new account" });
      }
    }

    // Validate liability-specific fields
    if (body.creditLimit !== undefined && (typeof body.creditLimit !== "number" || body.creditLimit < 0)) {
      reply.code(400).send({ error: "creditLimit must be a non-negative number" });
      return;
    }
    if (body.interestRate !== undefined && (typeof body.interestRate !== "number" || body.interestRate < 0)) {
      reply.code(400).send({ error: "interestRate must be a non-negative number" });
      return;
    }
    if (body.billingDate !== undefined && (typeof body.billingDate !== "number" || body.billingDate < 1 || body.billingDate > 31)) {
      reply.code(400).send({ error: "billingDate must be between 1 and 31" });
      return;
    }

    const updated = db.transaction((tx) => {
      const row = (tx.update(accounts).set({
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.type && { type: body.type }),
        ...(body.icon !== undefined && { icon: body.icon }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.accountNumber !== undefined && { accountNumber: body.accountNumber }),
        ...(body.creditLimit !== undefined && { creditLimit: body.creditLimit }),
        ...(body.interestRate !== undefined && { interestRate: body.interestRate }),
        ...(body.billingDate !== undefined && { billingDate: body.billingDate }),
        ...(body.provider !== undefined && { provider: body.provider }),
        ...(body.parentId !== undefined && { parentId: body.parentId }),
        ...(body.liquidityClass !== undefined && { liquidityClass: body.liquidityClass }),
        ...(body.type !== undefined && body.type !== "asset" && { liquidityClass: "non_cash" }),
      }).where(eq(accounts.id, parseInt(id))).returning().all() as any[])[0];
      if (!row) throw new Error("Account update failed");
      bumpFinancialRevisionSync(tx);
      return row;
    });

    await precomputeAccountBalance(parseInt(id));

    return updated;
  });

  fastify.delete("/api/accounts/:id", {
    schema: { operationId: "deleteAccount", tags: ["accounts"], params: accountIdParamsSchema, response: accountDeleteResponse },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const accountId = parseInt(id);

    const [existing] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Account not found" });
      return;
    }

    if (existing.systemKey) {
      return reply.code(409).send({ error: "System accounts cannot be archived" });
    }
    const balance = await computeAccountBalance(accountId, db);
    if (balance !== 0) {
      return reply.code(409).send({ error: "Account has a non-zero balance; transfer or settle it before archiving" });
    }
    const [child] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.parentId, accountId)).limit(1);
    if (child) {
      return reply.code(409).send({ error: "Account has child accounts; re-parent or archive them first" });
    }

    db.transaction((tx) => {
      tx.update(accounts).set({ isActive: false }).where(eq(accounts.id, accountId)).run();
      tx.insert(auditLogs).values({
        entityType: "account",
        entityId: accountId,
        action: "archive",
        beforeSnapshot: Buffer.from(JSON.stringify(existing)),
        afterSnapshot: Buffer.from(JSON.stringify({ ...existing, isActive: false })),
      }).run();
      bumpFinancialRevisionSync(tx);
    });

    reply.code(204).send();
  });

  fastify.get("/api/accounts/:id/dependency-preview", {
    schema: { operationId: "getAccountDependencyPreview", tags: ["accounts"], params: accountIdParamsSchema, response: { 200: accountDependencyPreviewSchema, 400: reconciliationErrorSchema, 404: reconciliationErrorSchema } },
  }, async (request, reply) => {
    const accountId = Number((request.params as { id: string }).id);
    if (!Number.isSafeInteger(accountId) || accountId <= 0) return reply.code(400).send({ error: "Invalid account id" });
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    if (!account) return reply.code(404).send({ error: "Account not found" });
    const [balance, childRows, txRows, budgetRows, categoryRows] = await Promise.all([
      computeAccountBalance(accountId, db),
      db.select({ count: sql<number>`count(*)` }).from(accounts).where(eq(accounts.parentId, accountId)),
      db.select({ count: sql<number>`count(*)` }).from(transactionLines)
        .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
        .where(and(eq(transactionLines.accountId, accountId), sql`${transactions.status} <> 'draft'`)),
      db.select({ count: sql<number>`count(*)` }).from(budgetPlans)
        .innerJoin(categories, eq(budgetPlans.categoryId, categories.id))
        .where(eq(categories.reportingAccountId, accountId)),
      db.select({ count: sql<number>`count(*)` }).from(categories).where(eq(categories.reportingAccountId, accountId)),
    ]);
    const blockers: string[] = [];
    if (account.systemKey) blockers.push("System accounts cannot be archived");
    if (balance !== 0) blockers.push("Account has a non-zero balance");
    if (Number(childRows[0]?.count ?? 0) > 0) blockers.push("Account has child accounts");
    return {
      account,
      canArchive: account.isActive && blockers.length === 0,
      canRestore: !account.isActive,
      blockers,
      dependencies: {
        postedTransactions: Number(txRows[0]?.count ?? 0),
        budgetPlans: Number(budgetRows[0]?.count ?? 0),
        childAccounts: Number(childRows[0]?.count ?? 0),
        linkedCategories: Number(categoryRows[0]?.count ?? 0),
      },
      consequence: "Archiving hides the account from new entries but preserves its journal history, budgets, and category mappings.",
    };
  });

  fastify.post("/api/accounts/:id/restore", {
    schema: { operationId: "restoreAccount", tags: ["accounts"], params: accountIdParamsSchema, response: { 200: accountRecordSchema, 400: reconciliationErrorSchema, 404: reconciliationErrorSchema, 409: reconciliationErrorSchema } },
  }, async (request, reply) => {
    const accountId = Number((request.params as { id: string }).id);
    if (!Number.isSafeInteger(accountId) || accountId <= 0) return reply.code(400).send({ error: "Invalid account id" });
    const [existing] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    if (!existing) return reply.code(404).send({ error: "Account not found" });
    if (existing.isActive) return existing;
    if (existing.parentId != null) {
      const [parent] = await db.select({ isActive: accounts.isActive }).from(accounts).where(eq(accounts.id, existing.parentId)).limit(1);
      if (!parent?.isActive) return reply.code(409).send({ error: "Restore the parent account first" });
    }
    const restored = db.transaction((tx) => {
      const [row] = tx.update(accounts).set({ isActive: true }).where(eq(accounts.id, accountId)).returning().all() as any[];
      if (!row) throw new Error("Account restore failed");
      tx.insert(auditLogs).values({
        entityType: "account",
        entityId: accountId,
        action: "restore",
        beforeSnapshot: Buffer.from(JSON.stringify(existing)),
        afterSnapshot: Buffer.from(JSON.stringify(row)),
      }).run();
      bumpFinancialRevisionSync(tx);
      return row;
    });
    return restored;
  });

  fastify.post("/api/accounts/:id/opening-balance", {
    schema: {
      operationId: "setAccountOpeningBalance",
      tags: ["accounts"],
      params: accountIdParamsSchema,
      body: openingBalanceBodySchema,
      response: { 201: openingBalanceResultSchema, 400: reconciliationErrorSchema, 404: reconciliationErrorSchema, 409: reconciliationErrorSchema },
    },
  }, async (request, reply) => {
    const accountId = Number((request.params as { id: string }).id);
    const body = request.body as { balance: number; asOfDate?: number; note?: string | null };
    const asOfDate = body.asOfDate ?? Date.now();
    if (!Number.isSafeInteger(body.balance) || body.balance <= 0) {
      return reply.code(400).send({ error: "Opening balance must be a positive whole-rupiah amount" });
    }
    if (!Number.isSafeInteger(asOfDate) || asOfDate < 0 || asOfDate > Date.now()) {
      return reply.code(400).send({ error: "asOfDate must be a current or historical timestamp" });
    }

    const [account] = await db.select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      liquidityClass: accounts.liquidityClass,
      systemKey: accounts.systemKey,
      isActive: accounts.isActive,
    }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
    if (!account) return reply.code(404).send({ error: "Account not found" });
    if (!account.isActive || !["asset", "liability"].includes(account.type) || account.systemKey) {
      return reply.code(400).send({ error: "Opening balances are available only for active user asset and liability accounts" });
    }
    const [existingLine] = await db.select({ id: transactionLines.id }).from(transactionLines)
      .where(eq(transactionLines.accountId, accountId)).limit(1);
    if (existingLine) return reply.code(409).send({ error: "This account already has ledger activity; use Reconcile to align it instead" });

    const note = body.note?.trim() || `Starting balance when ${account.name} was added`;
    try {
      const prepared = await prepareBalanceAdjustmentJournal({
        date: asOfDate,
        description: `Opening balance · ${account.name}`,
        note,
        items: [{
          accountId: account.id,
          accountName: account.name,
          accountType: account.type as "asset" | "liability",
          liquidityClass: account.liquidityClass,
          difference: body.balance,
        }],
      });
      if (!prepared) return reply.code(400).send({ error: "Opening balance must be greater than zero" });

      const result = db.transaction((tx) => {
        const [concurrentLine] = tx.select({ id: transactionLines.id }).from(transactionLines)
          .where(eq(transactionLines.accountId, accountId)).limit(1).all();
        if (concurrentLine) throw new Error("This account already has ledger activity; use Reconcile to align it instead");
        const transactionId = insertPreparedJournalEntrySync(tx, prepared);
        const session = tx.insert(reconciliationSessions).values({
          asOfDate: new Date(asOfDate),
          status: "adjusted",
          kind: "opening_balance",
          note,
        }).returning().all()[0];
        if (!session) throw new Error("Failed to record opening balance evidence");
        const item = {
          sessionId: session.id,
          accountId,
          ledgerBalance: 0,
          actualBalance: body.balance,
          difference: body.balance,
          status: "adjusted",
          correctionTransactionId: transactionId,
        };
        tx.insert(reconciliationItems).values(item).run();
        tx.insert(auditLogs).values({
          entityType: "reconciliation_session",
          entityId: session.id,
          action: "create_opening_balance",
          afterSnapshot: Buffer.from(JSON.stringify({ session, item, transactionId })),
        }).run();
        return { session, transactionId };
      });
      await invalidateOnTransactionMutation({
        transactionId: result.transactionId,
        affectedAccountIds: prepared.accountIds,
        affectedPeriodIds: prepared.periodId != null ? [prepared.periodId] : undefined,
        revisionBumped: true,
      });
      return reply.code(201).send({
        success: true as const,
        accountId,
        balance: body.balance,
        transactionId: result.transactionId,
        session: result.session,
        message: "Opening balance recorded as a separate equity adjustment, not income",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to set opening balance";
      if (message.includes("already has ledger activity")) return reply.code(409).send({ error: message });
      return reply.code(400).send({ error: message });
    }
  });

  // Reconciliation history is auditable balance evidence and links any posted adjustment journal.
  fastify.get("/api/reconciliation", {
    schema: { operationId: "listReconciliation", tags: ["reconciliation"], querystring: z.object({ limit: z.string().regex(/^\d+$/).optional() }), response: { 200: reconciliationHistorySchema, 400: reconciliationErrorSchema } },
  }, async (request, reply) => {
    const requestedLimit = Number((request.query as { limit?: string }).limit ?? 20);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
      return reply.code(400).send({ error: "limit must be a positive integer" });
    }
    const sessions = await db.select().from(reconciliationSessions)
      .orderBy(desc(reconciliationSessions.asOfDate))
      .limit(Math.min(requestedLimit, 100));
    const sessionIds = sessions.map((session) => session.id);
    const items = sessionIds.length === 0 ? [] : await db.select({
      id: reconciliationItems.id,
      sessionId: reconciliationItems.sessionId,
      accountId: reconciliationItems.accountId,
      accountName: accounts.name,
      ledgerBalance: reconciliationItems.ledgerBalance,
      actualBalance: reconciliationItems.actualBalance,
      difference: reconciliationItems.difference,
      status: reconciliationItems.status,
      correctionTransactionId: reconciliationItems.correctionTransactionId,
    }).from(reconciliationItems)
      .innerJoin(accounts, eq(reconciliationItems.accountId, accounts.id))
      .where(inArray(reconciliationItems.sessionId, sessionIds));
    const itemsBySession = new Map<number, typeof items>();
    for (const item of items) {
      const current = itemsBySession.get(item.sessionId) ?? [];
      current.push(item);
      itemsBySession.set(item.sessionId, current);
    }
    return { sessions: sessions.map((session) => ({ ...session, items: itemsBySession.get(session.id) ?? [] })) };
  });

  // Reconciliation endpoint
  fastify.post("/api/reconciliation", {
    schema: { operationId: "createReconciliation", tags: ["reconciliation"], body: reconciliationBodySchema, response: { 201: reconciliationResultSchema, 400: reconciliationErrorSchema, 409: reconciliationErrorSchema, 500: reconciliationErrorSchema } },
  }, async (request, reply) => {
    const { balances, asOfDate: requestedAsOf, confirmed, note } = request.body as {
      balances: Array<{ accountId: number; actualBalance: number }>;
      asOfDate?: number;
      confirmed?: boolean;
      note?: string | null;
    };

    if (!Array.isArray(balances) || balances.length === 0) {
      return reply.code(400).send({ error: "balances array is required" });
    }
    const asOfDate = requestedAsOf ?? Date.now();
    if (!Number.isSafeInteger(asOfDate) || asOfDate < 0 || asOfDate > Date.now()) {
      return reply.code(400).send({ error: "asOfDate must be a current or historical timestamp" });
    }
    const accountIds = balances.map((item) => item.accountId);
    if (
      accountIds.some((id) => !Number.isInteger(id) || id <= 0) ||
      new Set(accountIds).size !== accountIds.length ||
      balances.some((item) => !Number.isSafeInteger(item.actualBalance))
    ) {
      return reply.code(400).send({
        error: "Each account must appear once with a positive integer ID and finite integer-rupiah balance",
      });
    }

    try {
      const accountRows = await db
        .select({ id: accounts.id, name: accounts.name, type: accounts.type, liquidityClass: accounts.liquidityClass, isActive: accounts.isActive })
        .from(accounts)
        .where(inArray(accounts.id, accountIds));
      if (accountRows.length !== accountIds.length) {
        return reply.code(400).send({ error: "One or more reconciliation accounts do not exist" });
      }
      const unsupported = accountRows.find(
        (account) => !account.isActive || !["asset", "liability"].includes(account.type),
      );
      if (unsupported) {
        return reply.code(400).send({
          error: `Account ${unsupported.id} must be an active asset or liability account`,
        });
      }

      const initialItems = calculateReconciliationItemsSync(db, balances, accountRows, asOfDate);
      const changedItems = initialItems.filter((item) => item.difference !== 0);
      if (changedItems.length > 0 && confirmed !== true) {
        return reply.code(400).send({ error: "Confirm posting the displayed differences as balance adjustments" });
      }
      const prepared = changedItems.length > 0
        ? await prepareBalanceAdjustmentJournal({
          date: asOfDate,
          description: "Balance reconciliation adjustment",
          note: note?.trim() || null,
          items: changedItems,
        })
        : null;

      const result = db.transaction((tx) => {
        const items = calculateReconciliationItemsSync(tx, balances, accountRows, asOfDate);
        if (items.some((item, index) => item.ledgerBalance !== initialItems[index]?.ledgerBalance)) {
          throw new Error("Balances changed while preparing reconciliation; review and retry");
        }
        const adjustmentTransactionId = prepared == null ? null : insertPreparedJournalEntrySync(tx, prepared);
        const session = tx
          .insert(reconciliationSessions)
          .values({
            asOfDate: new Date(asOfDate),
            status: adjustmentTransactionId == null ? "reconciled" : "adjusted",
            kind: adjustmentTransactionId == null ? "control" : "adjustment",
            note: note?.trim() || null,
          })
          .returning()
          .all()[0];
        if (!session) throw new Error("Failed to create reconciliation session");
        const insertedItems = tx
          .insert(reconciliationItems)
          .values(items.map((item) => ({
            sessionId: session.id,
            accountId: item.accountId,
            ledgerBalance: item.ledgerBalance,
            actualBalance: item.actualBalance,
            difference: item.difference,
            status: item.difference === 0 ? "matched" : adjustmentTransactionId == null ? "needs_classification" : "adjusted",
            correctionTransactionId: item.difference === 0 ? null : adjustmentTransactionId,
          })))
          .returning()
          .all();
        tx.insert(auditLogs).values({
          entityType: "reconciliation_session",
          entityId: session.id,
          action: "create",
          afterSnapshot: Buffer.from(JSON.stringify({ session, items, adjustmentTransactionId })),
        }).run();
        return {
          session,
          items: insertedItems.map((row, index) => ({ ...row, accountName: items[index].accountName })),
          adjustmentTransactionId,
        };
      });
      if (result.adjustmentTransactionId != null && prepared != null) {
        await invalidateOnTransactionMutation({
          transactionId: result.adjustmentTransactionId,
          affectedAccountIds: prepared.accountIds,
          affectedPeriodIds: prepared.periodId != null ? [prepared.periodId] : undefined,
          revisionBumped: true,
        });
      }
      return reply.code(201).send({
        success: true,
        requiresClassification: false,
        session: result.session,
        results: result.items,
        adjustmentTransactionId: result.adjustmentTransactionId,
        message: result.adjustmentTransactionId == null
          ? "Balances matched; reconciliation evidence was recorded"
          : `Balances were aligned using a separate equity adjustment (${changedItems.length} account${changedItems.length === 1 ? "" : "s"}); no income, expense, budget actual, or ordinary cash flow was created`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to record reconciliation";
      if (message.includes("Balances changed while preparing")) return reply.code(409).send({ error: message });
      fastify.log.error(err);
      return reply.code(400).send({ error: message });
    }
  });

  // Return-after-absence recovery is intentionally separate from an ordinary
  // reconciliation. It requires a full asset/liability snapshot and posts an
  // approved equity bridge rather than inventing historical income or spend.
  fastify.post("/api/reconciliation/recovery", {
    schema: { operationId: "createRecoveryReconciliation", tags: ["reconciliation"], body: recoveryBodySchema, response: { 201: recoveryResultSchema, 400: reconciliationErrorSchema, 409: reconciliationErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as {
      balances?: Array<{ accountId: number; actualBalance: number }>;
      asOfDate?: number;
      acknowledgement?: string;
      note?: string | null;
      confirmed?: boolean;
    };
    if (body.confirmed !== true) {
      return reply.code(400).send({ error: "confirmed: true is required to post a historical recovery adjustment" });
    }
    try {
      const result = await createRecoveryReconciliation({
        balances: body.balances ?? [],
        asOfDate: body.asOfDate ?? Date.now(),
        acknowledgement: typeof body.acknowledgement === "string" ? body.acknowledgement : "",
        note: typeof body.note === "string" ? body.note : null,
      });
      return reply.code(201).send({
        success: true,
        session: result.session,
        results: result.items,
        recoveryTransactionId: result.recoveryTransactionId,
        message: result.recoveryTransactionId == null
          ? "Balances already matched; recovery evidence was recorded without an adjustment journal"
          : "A historical recovery bridge was posted. It is not income, expense, budget actual, or classified cash flow.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create recovery reconciliation";
      const retryable = message.includes("changed while preparing");
      return reply.code(retryable ? 409 : 400).send({ error: message });
    }
  });

  // Matched control sessions are evidence only and can be voided. Sessions
  // that posted balance adjustments are immutable; a later reconciliation
  // records the next correction without rewriting the audit trail.
  fastify.post("/api/reconciliation/:id/void", {
    schema: { operationId: "voidReconciliation", tags: ["reconciliation"], params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ reason: z.string().trim().min(1).max(500) }).passthrough(), response: { 200: reconciliationSessionSchema, 400: reconciliationErrorSchema, 404: reconciliationErrorSchema, 409: reconciliationErrorSchema } },
  }, async (request, reply) => {
    const sessionId = Number((request.params as { id: string }).id);
    const rawReason = (request.body as { reason?: unknown } | undefined)?.reason;
    const reason = typeof rawReason === "string" ? rawReason.trim() : "";
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      return reply.code(400).send({ error: "Invalid reconciliation session ID" });
    }
    if (!reason || reason.length > 500) {
      return reply.code(400).send({ error: "A void reason of at most 500 characters is required" });
    }
    try {
      const voided = db.transaction((tx) => {
        const session = tx.select().from(reconciliationSessions)
          .where(eq(reconciliationSessions.id, sessionId)).limit(1).all()[0];
        if (!session) throw new Error("Reconciliation session not found");
        if (session.kind !== "control") {
          throw new Error("Posted balance adjustments cannot be voided; create a later reconciliation so the ledger remains auditable");
        }
        if (session.lifecycleStatus !== "active") throw new Error("Reconciliation session is already voided");
        const updated = tx.update(reconciliationSessions)
          .set({ lifecycleStatus: "voided", voidedAt: new Date(), voidReason: reason })
          .where(and(
            eq(reconciliationSessions.id, sessionId),
            eq(reconciliationSessions.lifecycleStatus, "active"),
          ))
          .returning().all()[0];
        if (!updated) throw new Error("Reconciliation session was changed; retry voiding it");
        tx.insert(auditLogs).values({
          entityType: "reconciliation_session",
          entityId: sessionId,
          action: "void",
          beforeSnapshot: Buffer.from(JSON.stringify(session)),
          afterSnapshot: Buffer.from(JSON.stringify(updated)),
        }).run();
        return updated;
      });
      return reply.send(voided);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to void reconciliation session";
      return reply.code(message === "Reconciliation session not found" ? 404 : 409).send({ error: message });
    }
  });
}
