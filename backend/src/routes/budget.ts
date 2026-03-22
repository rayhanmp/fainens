import { eq, and, sql, isNull, or, gte, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { budgetPlans, categories, salaryPeriods, transactions, transactionLines, accounts } from "../db/schema";

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/budgets", async (request) => {
    const { periodId } = request.query as { periodId?: string };

    let plansQuery = db
      .select({
        id: budgetPlans.id,
        periodId: budgetPlans.periodId,
        categoryId: budgetPlans.categoryId,
        plannedAmount: budgetPlans.plannedAmount,
        categoryName: categories.name,
      })
      .from(budgetPlans)
      .innerJoin(categories, eq(budgetPlans.categoryId, categories.id));

    if (periodId) {
      plansQuery = plansQuery.where(eq(budgetPlans.periodId, parseInt(periodId))) as typeof plansQuery;
    }

    const plans = await plansQuery;

    const plansWithActual = await Promise.all(
      plans.map(async (plan) => {
        const [period] = await db
          .select()
          .from(salaryPeriods)
          .where(eq(salaryPeriods.id, plan.periodId))
          .limit(1);

        let actualAmount = 0;
        if (period) {
          const expenseAccounts = await db
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.type, "expense"));
          const expIds = expenseAccounts.map((a) => a.id);
          if (expIds.length > 0) {
            // Count transactions with matching periodId OR transactions with null periodId but date within range
            const [row] = await db
              .select({
                total: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
              })
              .from(transactions)
              .innerJoin(transactionLines, eq(transactions.id, transactionLines.transactionId))
              .where(
                and(
                  eq(transactions.categoryId, plan.categoryId),
                  sql`${transactionLines.accountId} IN (${sql.join(expIds.map(String), sql`, `)})`,
                  or(
                    eq(transactions.periodId, plan.periodId),
                    and(
                      isNull(transactions.periodId),
                      gte(transactions.date, new Date(period.startDate)),
                      lte(transactions.date, new Date(period.endDate))
                    )
                  ),
                ),
              );
            actualAmount = row?.total ?? 0;
          }
        }

        const variance = plan.plannedAmount - actualAmount;
        const percentUsed =
          plan.plannedAmount > 0 ? Math.round((actualAmount / plan.plannedAmount) * 10000) / 100 : 0;

        return {
          ...plan,
          actualAmount,
          variance,
          percentUsed,
        };
      }),
    );

    return plansWithActual;
  });

  fastify.post("/api/budgets", async (request, reply) => {
    const body = request.body as {
      periodId: number;
      categoryId: number;
      plannedAmount: number;
    };

    const [period] = await db
      .select()
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, body.periodId))
      .limit(1);

    if (!period) {
      reply.code(404).send({ error: "Salary period not found" });
      return;
    }

    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, body.categoryId))
      .limit(1);

    if (!category) {
      reply.code(404).send({ error: "Category not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(budgetPlans)
      .where(and(eq(budgetPlans.periodId, body.periodId), eq(budgetPlans.categoryId, body.categoryId)))
      .limit(1);

    if (existing) {
      reply.code(409).send({ error: "Budget plan already exists for this period and category" });
      return;
    }

    const [plan] = await db
      .insert(budgetPlans)
      .values({
        periodId: body.periodId,
        categoryId: body.categoryId,
        plannedAmount: body.plannedAmount,
      })
      .returning();

    reply.code(201).send(plan);
  });

  fastify.patch("/api/budgets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      plannedAmount: number;
    }>;

    const [existing] = await db
      .select()
      .from(budgetPlans)
      .where(eq(budgetPlans.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Budget plan not found" });
      return;
    }

    const [updated] = await db
      .update(budgetPlans)
      .set({
        ...(body.plannedAmount !== undefined && { plannedAmount: body.plannedAmount }),
      })
      .where(eq(budgetPlans.id, parseInt(id)))
      .returning();

    return updated;
  });

  fastify.delete("/api/budgets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(budgetPlans)
      .where(eq(budgetPlans.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Budget plan not found" });
      return;
    }

    await db.delete(budgetPlans).where(eq(budgetPlans.id, parseInt(id)));

    reply.code(204).send();
  });
}
