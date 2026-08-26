import { eq, and, sql, isNull, or, gte, lte, desc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";

const DAY_MS = 86_400_000;
import { auditLogs, budgetPlans, budgetTemplates, budgetTemplateItems, categories, salaryPeriods, transactions, transactionLines, accounts } from "../db/schema";
import { bumpFinancialRevisionSync } from "../services/financial-revision";
import { invalidateAllAnalytics, invalidateAllInsights, invalidatePeriodSummary } from "../cache/invalidation";

async function invalidateBudgetMutation(periodIds: number[]): Promise<void> {
  // The caller bumps the revision in the same SQLite transaction as the plan
  // mutation. Cache invalidation remains best-effort like the transaction
  // pipeline, so Redis outages never turn a committed write into a 500.
  await Promise.all([
    ...periodIds.map((periodId) => invalidatePeriodSummary(periodId)),
    invalidateAllAnalytics(),
    invalidateAllInsights(),
  ]);
}

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
              total: sql<number>`coalesce(sum(${transactionLines.credit} - ${transactionLines.debit}), 0)`,
            })
            .from(transactions)
            .innerJoin(transactionLines, eq(transactions.id, transactionLines.transactionId))
            .where(
              and(
                sql`${transactionLines.accountId} IN (${sql.join(revIds.map(String), sql`, `)})`,
                sql`${transactions.status} <> 'draft'`,
                // `transactions.date` uses Drizzle's timestamp_ms mode, whose
                // query encoder expects Date objects. Salary-period boundaries
                // are intentionally stored as numeric milliseconds.
                gte(transactions.date, new Date(period.startDate)),
                lte(transactions.date, new Date(period.endDate + DAY_MS - 1)),
                or(eq(transactions.periodId, pid), isNull(transactions.periodId)),
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
                  total: sql<number>`coalesce(sum(${transactionLines.debit} - ${transactionLines.credit}), 0)`,
                })
                .from(transactions)
                .innerJoin(transactionLines, eq(transactions.id, transactionLines.transactionId))
                .where(
                  and(
                    eq(transactions.categoryId, plan.categoryId),
                    sql`${transactionLines.accountId} IN (${sql.join(expIds.map(String), sql`, `)})`,
                    sql`${transactions.status} <> 'draft'`,
                    gte(transactions.date, new Date(period.startDate)),
                    lte(transactions.date, new Date(period.endDate + DAY_MS - 1)),
                    or(eq(transactions.periodId, plan.periodId), isNull(transactions.periodId)),
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
    if (period.status === "closed") {
      reply.code(409).send({ error: "Period is closed; reopen it before changing its budget" });
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

    const plan = db.transaction((tx) => {
      const inserted = tx.insert(budgetPlans)
        .values({
          periodId: body.periodId,
          categoryId: body.categoryId,
          plannedAmount: body.plannedAmount,
        })
        .returning().all()[0];
      if (!inserted) throw new Error("Failed to create budget plan");
      bumpFinancialRevisionSync(tx);
      return inserted;
    });

    await invalidateBudgetMutation([body.periodId]);

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
    const [period] = await db.select({ status: salaryPeriods.status }).from(salaryPeriods)
      .where(eq(salaryPeriods.id, existing.periodId)).limit(1);
    if (!period) return reply.code(409).send({ error: "Budget plan has no valid period" });
    if (period.status === "closed") {
      return reply.code(409).send({ error: "Period is closed; reopen it before changing its budget" });
    }

    const updated = db.transaction((tx) => {
      const row = tx.update(budgetPlans)
        .set({
          ...(body.plannedAmount !== undefined && { plannedAmount: body.plannedAmount }),
        })
        .where(eq(budgetPlans.id, parseInt(id)))
        .returning().all()[0];
      if (!row) throw new Error("Budget plan was changed; retry the update");
      bumpFinancialRevisionSync(tx);
      return row;
    });

    await invalidateBudgetMutation([existing.periodId]);

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
    const [period] = await db.select({ status: salaryPeriods.status }).from(salaryPeriods)
      .where(eq(salaryPeriods.id, existing.periodId)).limit(1);
    if (!period) return reply.code(409).send({ error: "Budget plan has no valid period" });
    if (period.status === "closed") {
      return reply.code(409).send({ error: "Period is closed; reopen it before changing its budget" });
    }

    db.transaction((tx) => {
      const deleted = tx.delete(budgetPlans).where(eq(budgetPlans.id, parseInt(id))).run();
      if (deleted.changes !== 1) throw new Error("Budget plan was changed; retry the delete");
      bumpFinancialRevisionSync(tx);
    });

    await invalidateBudgetMutation([existing.periodId]);

    reply.code(204).send();
  });

  // Get all budget templates
  fastify.get("/api/budgets/templates", async (request) => {
    const { includeInactive } = request.query as { includeInactive?: string };
    const templates = await db
      .select({
        id: budgetTemplates.id,
        name: budgetTemplates.name,
        description: budgetTemplates.description,
        isActive: budgetTemplates.isActive,
        createdAt: budgetTemplates.createdAt,
      })
      .from(budgetTemplates)
      .where(includeInactive === "true" ? undefined : eq(budgetTemplates.isActive, true))
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

    const [targetPeriod] = await db.select({ status: salaryPeriods.status }).from(salaryPeriods)
      .where(eq(salaryPeriods.id, body.periodId)).limit(1);
    if (!targetPeriod) return reply.code(404).send({ error: "Salary period not found" });
    if (targetPeriod.status === "closed") {
      return reply.code(409).send({ error: "Period is closed; reopen it before applying a budget template" });
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

    const applied = db.transaction((tx) => {
      let deletedCount = 0;
      if (body.replaceExisting) {
        deletedCount = tx.delete(budgetPlans).where(eq(budgetPlans.periodId, body.periodId)).run().changes;
      }
      const existingBudgets = tx.select({ categoryId: budgetPlans.categoryId })
        .from(budgetPlans)
        .where(eq(budgetPlans.periodId, body.periodId)).all();
      const existingCategoryIds = new Set(existingBudgets.map((budget) => budget.categoryId));
      const newItems = items.filter((item) => !existingCategoryIds.has(item.categoryId));
      if (newItems.length > 0) {
        tx.insert(budgetPlans).values(newItems.map((item) => ({
          periodId: body.periodId,
          categoryId: item.categoryId,
          plannedAmount: item.plannedAmount,
        }))).run();
      }
      const changedCount = deletedCount + newItems.length;
      if (changedCount > 0) bumpFinancialRevisionSync(tx);
      return { applied: newItems.length, skipped: items.length - newItems.length, changedCount };
    });

    if (applied.changedCount > 0) await invalidateBudgetMutation([body.periodId]);

    reply.code(200).send({
      applied: applied.applied,
      skipped: applied.skipped,
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
    if (!existing.isActive) {
      return reply.code(409).send({ error: "Template is already archived" });
    }

    db.transaction((tx) => {
      const updated = tx.update(budgetTemplates).set({ isActive: false })
        .where(and(eq(budgetTemplates.id, parseInt(id)), eq(budgetTemplates.isActive, true)))
        .returning().all()[0];
      if (!updated) throw new Error("Template was changed; retry archiving it");
      tx.insert(auditLogs).values({
        entityType: "budget_template",
        entityId: updated.id,
        action: "archive",
        beforeSnapshot: Buffer.from(JSON.stringify(existing)),
        afterSnapshot: Buffer.from(JSON.stringify(updated)),
      }).run();
    });

    reply.code(204).send();
  });

  fastify.post("/api/budgets/templates/:id/restore", async (request, reply) => {
    const templateId = Number((request.params as { id: string }).id);
    if (!Number.isSafeInteger(templateId) || templateId <= 0) {
      return reply.code(400).send({ error: "Invalid template ID" });
    }
    try {
      const restored = db.transaction((tx) => {
        const existing = tx.select().from(budgetTemplates).where(eq(budgetTemplates.id, templateId)).limit(1).all()[0];
        if (!existing) throw new Error("Template not found");
        if (existing.isActive) throw new Error("Template is already active");
        const updated = tx.update(budgetTemplates).set({ isActive: true })
          .where(and(eq(budgetTemplates.id, templateId), eq(budgetTemplates.isActive, false)))
          .returning().all()[0];
        if (!updated) throw new Error("Template was changed; retry restoring it");
        tx.insert(auditLogs).values({
          entityType: "budget_template",
          entityId: templateId,
          action: "restore",
          beforeSnapshot: Buffer.from(JSON.stringify(existing)),
          afterSnapshot: Buffer.from(JSON.stringify(updated)),
        }).run();
        return updated;
      });
      return reply.send(restored);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to restore template";
      return reply.code(message === "Template not found" ? 404 : 409).send({ error: message });
    }
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
                total: sql<number>`coalesce(sum(${transactionLines.debit} - ${transactionLines.credit}), 0)`,
              })
              .from(transactions)
              .innerJoin(transactionLines, eq(transactions.id, transactionLines.transactionId))
              .where(
                and(
                  eq(transactions.categoryId, budget.categoryId),
                  sql`${transactionLines.accountId} IN (${sql.join(expIds.map(String), sql`, `)})`,
                  sql`${transactions.status} <> 'draft'`,
                  gte(transactions.date, comparePeriod.startDate),
                  lte(transactions.date, comparePeriod.endDate + DAY_MS - 1),
                  or(eq(transactions.periodId, parseInt(comparePeriodId)), isNull(transactions.periodId)),
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
