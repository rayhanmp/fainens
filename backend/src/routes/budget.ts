import { eq, and, sql, isNull, or, gte, lte, desc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { budgetPlans, budgetTemplates, budgetTemplateItems, categories, salaryPeriods, transactions, transactionLines, accounts } from "../db/schema";

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/budgets", async (request) => {
    const { periodId } = request.query as { periodId?: string };

    // Get all periods with budgets or the requested one
    let periodsToFetch: number[] = [];
    if (periodId) {
      periodsToFetch = [parseInt(periodId)];
    } else {
      const allPlans = await db.select({ periodId: budgetPlans.periodId }).from(budgetPlans);
      periodsToFetch = [...new Set(allPlans.map(p => p.periodId))];
    }

    const budgetSummary: {
      periodId: number;
      income: number;
      totalPlanned: number;
      percentOfIncome: number;
      plans: Array<{
        id: number;
        periodId: number;
        categoryId: number;
        plannedAmount: number;
        categoryName: string;
        actualAmount: number;
        variance: number;
        percentUsed: number;
      }>;
    }[] = [];

    for (const pid of periodsToFetch) {
      const [period] = await db
        .select()
        .from(salaryPeriods)
        .where(eq(salaryPeriods.id, pid))
        .limit(1);

      let totalIncome = 0;
      if (period) {
        const revenueAccounts = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.type, "revenue"));
        const revIds = revenueAccounts.map((a) => a.id);

        if (revIds.length > 0) {
          const [incomeRow] = await db
            .select({
              total: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
            })
            .from(transactions)
            .innerJoin(transactionLines, eq(transactions.id, transactionLines.transactionId))
            .where(
              and(
                sql`${transactionLines.accountId} IN (${sql.join(revIds.map(String), sql`, `)})`,
                or(
                  eq(transactions.periodId, pid),
                  and(
                    isNull(transactions.periodId),
                    gte(transactions.date, new Date(period.startDate)),
                    lte(transactions.date, new Date(period.endDate))
                  )
                ),
              ),
            );
          totalIncome = incomeRow?.total ?? 0;
        }
      }

      let plansQuery = db
        .select({
          id: budgetPlans.id,
          periodId: budgetPlans.periodId,
          categoryId: budgetPlans.categoryId,
          plannedAmount: budgetPlans.plannedAmount,
          categoryName: categories.name,
        })
        .from(budgetPlans)
        .innerJoin(categories, eq(budgetPlans.categoryId, categories.id))
        .where(eq(budgetPlans.periodId, pid)) as any;

      const plans = await plansQuery;

      const plansWithActual = await Promise.all(
        plans.map(async (plan: typeof plans[number]) => {
          let actualAmount = 0;
          if (period) {
            const expenseAccounts = await db
              .select({ id: accounts.id })
              .from(accounts)
              .where(eq(accounts.type, "expense"));
            const expIds = expenseAccounts.map((a) => a.id);
            if (expIds.length > 0) {
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

      const totalPlanned = plans.reduce((sum: number, p: typeof plans[number]) => sum + p.plannedAmount, 0);
      const percentOfIncome = totalIncome > 0 ? Math.round((totalPlanned / totalIncome) * 10000) / 100 : 0;

      budgetSummary.push({
        periodId: pid,
        income: totalIncome,
        totalPlanned,
        percentOfIncome,
        plans: plansWithActual,
      });
    }

    if (periodId) {
      return budgetSummary[0];
    }
    return budgetSummary;
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

  // Get all budget templates
  fastify.get("/api/budgets/templates", async () => {
    const templates = await db
      .select({
        id: budgetTemplates.id,
        name: budgetTemplates.name,
        description: budgetTemplates.description,
        isActive: budgetTemplates.isActive,
        createdAt: budgetTemplates.createdAt,
      })
      .from(budgetTemplates)
      .where(eq(budgetTemplates.isActive, true))
      .orderBy(desc(budgetTemplates.createdAt));

    const templatesWithItems = await Promise.all(
      templates.map(async (template) => {
        const items = await db
          .select({
            id: budgetTemplateItems.id,
            categoryId: budgetTemplateItems.categoryId,
            plannedAmount: budgetTemplateItems.plannedAmount,
            categoryName: categories.name,
          })
          .from(budgetTemplateItems)
          .innerJoin(categories, eq(budgetTemplateItems.categoryId, categories.id))
          .where(eq(budgetTemplateItems.templateId, template.id))
          .orderBy(budgetTemplateItems.sortOrder);

        return {
          ...template,
          items,
        };
      })
    );

    return templatesWithItems;
  });

  // Create a new budget template from current period
  fastify.post("/api/budgets/templates", async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string;
      periodId: number;
    };

    if (!body.name || !body.periodId) {
      reply.code(400).send({ error: "Name and periodId are required" });
      return;
    }

    // Get all budget plans for this period
    const plans = await db
      .select({
        categoryId: budgetPlans.categoryId,
        plannedAmount: budgetPlans.plannedAmount,
      })
      .from(budgetPlans)
      .where(eq(budgetPlans.periodId, body.periodId));

    if (plans.length === 0) {
      reply.code(400).send({ error: "No budget plans found for this period" });
      return;
    }

    // Create template
    const [template] = await db
      .insert(budgetTemplates)
      .values({
        name: body.name,
        description: body.description || null,
        isActive: true,
      })
      .returning();

    // Create template items
    await db.insert(budgetTemplateItems).values(
      plans.map((plan, index) => ({
        templateId: template.id,
        categoryId: plan.categoryId,
        plannedAmount: plan.plannedAmount,
        sortOrder: index,
      }))
    );

    reply.code(201).send(template);
  });

  // Apply a template to a period
  fastify.post("/api/budgets/templates/:id/apply", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { periodId: number; replaceExisting?: boolean };

    if (!body.periodId) {
      reply.code(400).send({ error: "periodId is required" });
      return;
    }

    // Get template
    const [template] = await db
      .select()
      .from(budgetTemplates)
      .where(eq(budgetTemplates.id, parseInt(id)))
      .limit(1);

    if (!template) {
      reply.code(404).send({ error: "Template not found" });
      return;
    }

    // Get template items
    const items = await db
      .select({
        categoryId: budgetTemplateItems.categoryId,
        plannedAmount: budgetTemplateItems.plannedAmount,
      })
      .from(budgetTemplateItems)
      .where(eq(budgetTemplateItems.templateId, parseInt(id)));

    if (body.replaceExisting) {
      // Delete existing budgets for this period
      await db.delete(budgetPlans).where(eq(budgetPlans.periodId, body.periodId));
    }

    // Get existing budgets to avoid duplicates
    const existingBudgets = await db
      .select({ categoryId: budgetPlans.categoryId })
      .from(budgetPlans)
      .where(eq(budgetPlans.periodId, body.periodId));

    const existingCategoryIds = new Set(existingBudgets.map((b) => b.categoryId));

    // Create new budgets from template items (only for categories that don't exist)
    const newItems = items.filter((item) => !existingCategoryIds.has(item.categoryId));

    if (newItems.length > 0) {
      await db.insert(budgetPlans).values(
        newItems.map((item) => ({
          periodId: body.periodId,
          categoryId: item.categoryId,
          plannedAmount: item.plannedAmount,
        }))
      );
    }

    reply.code(200).send({
      applied: newItems.length,
      skipped: items.length - newItems.length,
    });
  });

  // Delete a template
  fastify.delete("/api/budgets/templates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(budgetTemplates)
      .where(eq(budgetTemplates.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Template not found" });
      return;
    }

    // Soft delete by setting isActive to false
    await db
      .update(budgetTemplates)
      .set({ isActive: false })
      .where(eq(budgetTemplates.id, parseInt(id)));

    reply.code(204).send();
  });

  // Compare budgets between two periods
  fastify.get("/api/budgets/compare", async (request, reply) => {
    const { currentPeriodId, comparePeriodId } = request.query as {
      currentPeriodId?: string;
      comparePeriodId?: string;
    };

    if (!currentPeriodId || !comparePeriodId) {
      reply.code(400).send({ error: "Both currentPeriodId and comparePeriodId are required" });
      return;
    }

    // Get current period budgets
    const currentBudgets = await db
      .select({
        id: budgetPlans.id,
        categoryId: budgetPlans.categoryId,
        plannedAmount: budgetPlans.plannedAmount,
        categoryName: categories.name,
      })
      .from(budgetPlans)
      .innerJoin(categories, eq(budgetPlans.categoryId, categories.id))
      .where(eq(budgetPlans.periodId, parseInt(currentPeriodId)));

    // Get comparison period budgets
    const compareBudgets = await db
      .select({
        categoryId: budgetPlans.categoryId,
        plannedAmount: budgetPlans.plannedAmount,
        actualAmount: budgetPlans.plannedAmount, // Will calculate actual below
      })
      .from(budgetPlans)
      .where(eq(budgetPlans.periodId, parseInt(comparePeriodId)));

    // Get compare period for date range
    const [comparePeriod] = await db
      .select()
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, parseInt(comparePeriodId)))
      .limit(1);

    // Calculate actual amounts for comparison period
    const compareBudgetsWithActual = await Promise.all(
      compareBudgets.map(async (budget) => {
        let actualAmount = 0;
        if (comparePeriod) {
          const expenseAccounts = await db
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.type, "expense"));
          const expIds = expenseAccounts.map((a) => a.id);
          if (expIds.length > 0) {
            const [row] = await db
              .select({
                total: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
              })
              .from(transactions)
              .innerJoin(transactionLines, eq(transactions.id, transactionLines.transactionId))
              .where(
                and(
                  eq(transactions.categoryId, budget.categoryId),
                  sql`${transactionLines.accountId} IN (${sql.join(expIds.map(String), sql`, `)})`,
                  or(
                    eq(transactions.periodId, parseInt(comparePeriodId)),
                    and(
                      isNull(transactions.periodId),
                      gte(transactions.date, new Date(comparePeriod.startDate)),
                      lte(transactions.date, new Date(comparePeriod.endDate))
                    )
                  ),
                ),
              );
            actualAmount = row?.total ?? 0;
          }
        }
        return { ...budget, actualAmount };
      })
    );

    // Create a map for easy lookup
    const compareMap = new Map(
      compareBudgetsWithActual.map((b) => [
        b.categoryId,
        { plannedAmount: b.plannedAmount, actualAmount: b.actualAmount },
      ])
    );

    // Build comparison result
    const comparison = currentBudgets.map((current) => {
      const compare = compareMap.get(current.categoryId);
      return {
        categoryId: current.categoryId,
        categoryName: current.categoryName,
        currentPlanned: current.plannedAmount,
        comparePlanned: compare?.plannedAmount || 0,
        compareActual: compare?.actualAmount || 0,
        plannedDiff: compare ? current.plannedAmount - compare.plannedAmount : 0,
        actualDiff: compare ? current.plannedAmount - compare.actualAmount : 0,
      };
    });

    return comparison;
  });
}
