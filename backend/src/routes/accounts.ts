import { eq, like, desc, and, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { accounts, auditLogs, reconciliationItems, reconciliationSessions, transactionLines, transactions } from "../db/schema";
import { computeAccountBalance, computeAccountBalanceRolledUp } from "../services/ledger";
import { precomputeAccountBalance } from "../cache/precompute";
import { calculateReconciliationItem } from "../services/reconciliation";
import { bumpFinancialRevisionSync } from "../services/financial-revision";

const accountTypeEnum = ["asset", "liability", "equity", "revenue", "expense"] as const;

// Sanitize search input to prevent SQL injection
function sanitizeSearchInput(input: string): string {
  // Remove SQL special characters that could be used for injection
  return input.replace(/[%_\[\]]/g, '');
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/accounts", async (request) => {
    const { type, search } = request.query as {
      type?: string;
      search?: string;
    };

    const conditions = [eq(accounts.isActive, true)];
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

  fastify.get("/api/accounts/:id", async (request, reply) => {
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

  fastify.post("/api/accounts", async (request, reply) => {
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
      }).returning().all() as any[])[0];
      if (!inserted) throw new Error("Failed to create account");
      bumpFinancialRevisionSync(tx);
      return inserted;
    });

    reply.code(201).send(account);
  });

  fastify.patch("/api/accounts/:id", async (request, reply) => {
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
    }>;

    const [existing] = await db.select().from(accounts).where(eq(accounts.id, parseInt(id))).limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Account not found" });
      return;
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
        ...(body.name !== undefined && { name: body.name }),
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
      }).where(eq(accounts.id, parseInt(id))).returning().all() as any[])[0];
      if (!row) throw new Error("Account update failed");
      bumpFinancialRevisionSync(tx);
      return row;
    });

    await precomputeAccountBalance(parseInt(id));

    return updated;
  });

  fastify.delete("/api/accounts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const accountId = parseInt(id);

    const [existing] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Account not found" });
      return;
    }

    console.log(`Deleting account ${accountId}, was isActive: ${existing.isActive}`);

    db.transaction((tx) => {
      tx.update(accounts).set({ isActive: false }).where(eq(accounts.id, accountId)).run();
      bumpFinancialRevisionSync(tx);
    });

    // Verify it was updated
    const [updated] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    console.log(`Account ${accountId} isActive after delete:`, updated?.isActive);

    reply.code(204).send();
  });

  // Reconciliation endpoint
  fastify.post("/api/reconciliation", async (request, reply) => {
    const { balances, asOfDate: requestedAsOf } = request.body as {
      balances: Array<{ accountId: number; actualBalance: number }>;
      asOfDate?: number;
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
        .select({ id: accounts.id, name: accounts.name, type: accounts.type, isActive: accounts.isActive })
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

      const result = db.transaction((tx) => {
        const items = balances.map((item) => {
          const account = accountRows.find((row) => row.id === item.accountId)!;
          const sums = tx
            .select({
              debit: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
              credit: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
            })
            .from(transactionLines)
            .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
            .where(and(
              eq(transactionLines.accountId, item.accountId),
              sql`${transactions.date} <= ${asOfDate}`,
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
            ledgerBalance: calculated.ledgerBalance,
            actualBalance: item.actualBalance,
            difference: calculated.difference,
            status: calculated.status,
          };
        });
        const allMatched = items.every((item) => item.difference === 0);
        const session = tx
          .insert(reconciliationSessions)
          .values({
            asOfDate: new Date(asOfDate),
            status: allMatched ? "reconciled" : "needs_classification",
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
            status: item.status,
          })))
          .returning()
          .all();
        tx.insert(auditLogs).values({
          entityType: "reconciliation_session",
          entityId: session.id,
          action: "create",
          afterSnapshot: Buffer.from(JSON.stringify({ session, items })),
        }).run();
        bumpFinancialRevisionSync(tx);
        return { session, items: insertedItems.map((row, index) => ({ ...row, accountName: items[index].accountName })) };
      });
      const requiresClassification = result.items.some((item) => item.difference !== 0);
      return reply.code(201).send({
        success: !requiresClassification,
        requiresClassification,
        session: result.session,
        results: result.items,
        message: requiresClassification
          ? "Differences were recorded for review; no income or expense transaction was created"
          : "Balances matched; reconciliation evidence was recorded",
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: "Failed to record reconciliation" });
    }
  });
}
