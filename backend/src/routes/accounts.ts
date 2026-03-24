import { eq, like, desc, and, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { accounts, categories } from "../db/schema";
import { computeAccountBalance, computeAccountBalanceRolledUp, createSimpleTransaction, getOrCreateAutoIncomeAccount, getOrCreateAutoExpenseAccount } from "../services/ledger";
import { precomputeAccountBalance } from "../cache/precompute";
import { invalidateOnTransactionMutation } from "../cache";

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

    const [account] = await db
      .insert(accounts)
      .values({
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
      })
      .returning();

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

    const [updated] = await db
      .update(accounts)
      .set({
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
      })
      .where(eq(accounts.id, parseInt(id)))
      .returning();

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

    await db.update(accounts).set({ isActive: false }).where(eq(accounts.id, accountId));

    // Verify it was updated
    const [updated] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    console.log(`Account ${accountId} isActive after delete:`, updated?.isActive);

    reply.code(204).send();
  });

  // Reconciliation endpoint
  fastify.post("/api/reconciliation", async (request, reply) => {
    const { balances } = request.body as {
      balances: Array<{ accountId: number; actualBalance: number }>;
    };

    if (!Array.isArray(balances) || balances.length === 0) {
      reply.code(400).send({ error: "balances array is required" });
      return;
    }

    try {
      // Find or create Reconciliation category
      let [reconciliationCategory] = await db
        .select()
        .from(categories)
        .where(eq(categories.name, "Reconciliation"))
        .limit(1);

      if (!reconciliationCategory) {
        const [created] = await db
          .insert(categories)
          .values({
            name: "Reconciliation",
            color: "#6366f1",
            icon: "scale",
          })
          .returning();
        reconciliationCategory = created;
      }

      const results: Array<{ accountId: number; difference: number; transactionId?: number; error?: string }> = [];

      for (const item of balances) {
        try {
          // Get account name for description
          const [account] = await db
            .select({ name: accounts.name })
            .from(accounts)
            .where(eq(accounts.id, item.accountId))
            .limit(1);
          
          const accountName = account?.name || `Account ${item.accountId}`;
          const ledgerBalance = await computeAccountBalance(item.accountId, db);
          const difference = item.actualBalance - ledgerBalance;

          if (difference === 0) {
            results.push({ accountId: item.accountId, difference: 0 });
            continue;
          }

          let transactionId: number | undefined;

          if (difference > 0) {
            // Found extra money - create income
            const incomeAccount = await getOrCreateAutoIncomeAccount(db);
            const result = await createSimpleTransaction({
              kind: "income",
              amountCents: difference,
              description: `Reconciliation: ${accountName}`,
              date: new Date(),
              walletAccountId: item.accountId,
              categoryId: reconciliationCategory.id,
              txType: "reconciliation_income",
            });
            transactionId = result.transactionId;
          } else if (difference < 0) {
            // Missing money - create expense
            const expenseAccount = await getOrCreateAutoExpenseAccount(db);
            const result = await createSimpleTransaction({
              kind: "expense",
              amountCents: Math.abs(difference),
              description: `Reconciliation: ${accountName}`,
              date: new Date(),
              walletAccountId: item.accountId,
              categoryId: reconciliationCategory.id,
              txType: "reconciliation_expense",
            });
            transactionId = result.transactionId;
          }

          // Invalidate cache
          await invalidateOnTransactionMutation({
            transactionId: transactionId!,
            affectedAccountIds: [item.accountId, difference > 0 ? (await getOrCreateAutoIncomeAccount(db)).id : (await getOrCreateAutoExpenseAccount(db)).id],
          });

          results.push({ accountId: item.accountId, difference, transactionId });
        } catch (itemErr) {
          results.push({ accountId: item.accountId, difference: 0, error: (itemErr as Error).message });
        }
      }

      reply.send({ success: true, results });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Failed to process reconciliation" });
    }
  });
}
