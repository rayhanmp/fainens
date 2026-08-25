import { eq, desc, sql, and, lte, gte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { salaryPeriods, budgetPlans, categories, salarySettings, transactions } from "../db/schema";
import { precomputePeriodSummary } from "../cache/precompute";
import { bumpFinancialRevisionSync } from "../services/financial-revision";

const DAY_MS = 24 * 60 * 60 * 1000;
function inclusiveEnd(ms: number): number {
  return ms % DAY_MS === 0 ? ms + DAY_MS - 1 : ms;
}

async function assertNoPeriodOverlap(startMs: number, endMs: number, excludeId?: number): Promise<void> {
  const periods = await db.select({ id: salaryPeriods.id, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
    .from(salaryPeriods);
  const overlap = periods.find((period) => period.id !== excludeId &&
    startMs <= inclusiveEnd(Number(period.endDate)) && Number(period.startDate) <= inclusiveEnd(endMs));
  if (overlap) throw new Error(`Period overlaps existing period ${overlap.id}`);
}

export default async function (fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // List all salary periods
  fastify.get("/api/periods", async () => {
    const periods = await db
      .select()
      .from(salaryPeriods)
      .orderBy(desc(salaryPeriods.startDate));

    return periods;
  });

  // Get single period with summary
  fastify.get("/api/periods/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [period] = await db
      .select()
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, parseInt(id)))
      .limit(1);

    if (!period) {
      reply.code(404).send({ error: "Period not found" });
      return;
    }

    // Get budget plans for this period
    const budgets = await db
      .select({
        id: budgetPlans.id,
        categoryId: budgetPlans.categoryId,
        plannedAmount: budgetPlans.plannedAmount,
        categoryName: categories.name,
      })
      .from(budgetPlans)
      .innerJoin(categories, eq(budgetPlans.categoryId, categories.id))
      .where(eq(budgetPlans.periodId, parseInt(id)));

    // Get cached summary
    let summary;
    try {
      summary = await precomputePeriodSummary(parseInt(id));
    } catch {
      summary = null;
    }

    return {
      ...period,
      summary,
      budgets,
    };
  });

  // Create salary period
  fastify.post("/api/periods", async (request, reply) => {
    const body = request.body as {
      name: string;
      startDate: string;
      endDate: string;
    };

    const startMs = new Date(body.startDate).getTime();
    const endMs = new Date(body.endDate).getTime();

    if (!body.name?.trim() || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      reply.code(400).send({ error: "name, startDate, and endDate are required; endDate must be after startDate" });
      return;
    }
    try { await assertNoPeriodOverlap(startMs, endMs); } catch (error) {
      reply.code(409).send({ error: (error as Error).message });
      return;
    }

    const period = db.transaction((tx) => {
      const inserted = (tx.insert(salaryPeriods).values({
        name: body.name.trim(), startDate: startMs, endDate: endMs,
      }).returning().all() as any[])[0];
      if (!inserted) throw new Error("Failed to create period");
      bumpFinancialRevisionSync(tx);
      return inserted;
    });

    reply.code(201).send(period);
  });

  // Update salary period
  fastify.patch("/api/periods/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      startDate: string;
      endDate: string;
    }>;

    const [existing] = await db
      .select()
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Period not found" });
      return;
    }

    const updates: any = {};

    if (body.name !== undefined) {
      if (!body.name.trim()) {
        reply.code(400).send({ error: "name cannot be empty" });
        return;
      }
      updates.name = body.name.trim();
    }
    if (body.startDate) updates.startDate = new Date(body.startDate).getTime();
    if (body.endDate) updates.endDate = new Date(body.endDate).getTime();

    // Validate date range if both dates are being updated or one is updated
    const startMs = updates.startDate ?? existing.startDate;
    const endMs = updates.endDate ?? existing.endDate;

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      reply.code(400).send({ error: "End date must be after start date" });
      return;
    }
    try { await assertNoPeriodOverlap(startMs, endMs, parseInt(id)); } catch (error) {
      reply.code(409).send({ error: (error as Error).message });
      return;
    }

    const updated = db.transaction((tx) => {
      const row = (tx.update(salaryPeriods).set(updates)
        .where(eq(salaryPeriods.id, parseInt(id))).returning().all() as any[])[0];
      if (!row) throw new Error("Period update failed");
      bumpFinancialRevisionSync(tx);
      return row;
    });

    // Invalidate cache
    await precomputePeriodSummary(parseInt(id));

    return updated;
  });

  // Delete salary period
  fastify.delete("/api/periods/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Period not found" });
      return;
    }

    const [linkedTransaction] = await db.select({ id: transactions.id }).from(transactions)
      .where(and(eq(transactions.periodId, parseInt(id)), sql`${transactions.status} <> 'draft'`)).limit(1);
    if (linkedTransaction) {
      reply.code(409).send({ error: "A period with posted transactions cannot be deleted; keep it for audit history" });
      return;
    }
    const [linkedBudget] = await db.select({ id: budgetPlans.id }).from(budgetPlans)
      .where(eq(budgetPlans.periodId, parseInt(id))).limit(1);
    if (linkedBudget) {
      reply.code(409).send({ error: "A period with budget plans cannot be deleted; remove or archive the plans first" });
      return;
    }
    db.transaction((tx) => {
      tx.delete(salaryPeriods).where(eq(salaryPeriods.id, parseInt(id))).run();
      bumpFinancialRevisionSync(tx);
    });

    reply.code(204).send();
  });

  // Get suggested next period dates
  fastify.get("/api/periods/suggest-next", async () => {
    const [latestPeriod] = await db
      .select()
      .from(salaryPeriods)
      .orderBy(desc(salaryPeriods.endDate))
      .limit(1);

    const [settings] = await db
      .select()
      .from(salarySettings)
      .limit(1);

    const payrollDay = settings?.payrollDay ?? 25;

    let suggestedStart: Date;
    let suggestedEnd: Date;

    if (!latestPeriod) {
      const now = new Date();
      suggestedStart = new Date(now.getFullYear(), now.getMonth(), payrollDay);
      suggestedEnd = new Date(suggestedStart.getFullYear(), suggestedStart.getMonth() + 1, payrollDay - 1);
    } else {
      const latestEnd = new Date(latestPeriod.endDate);
      suggestedStart = new Date(latestEnd.getFullYear(), latestEnd.getMonth(), payrollDay);
      if (suggestedStart.getTime() <= latestPeriod.endDate) {
        suggestedStart = new Date(latestEnd.getFullYear(), latestEnd.getMonth() + 1, payrollDay);
      }
      suggestedEnd = new Date(suggestedStart.getFullYear(), suggestedStart.getMonth() + 1, payrollDay - 1);
    }

    return {
      suggestedName: `${suggestedEnd.toLocaleString("default", { month: "long" })} ${suggestedEnd.getFullYear()}`,
      suggestedStartDate: suggestedStart.toISOString().split("T")[0],
      suggestedEndDate: suggestedEnd.toISOString().split("T")[0],
    };
  });

  // Auto-create next period
  fastify.post("/api/periods/auto-create", async (request, reply) => {
    const [latestPeriod] = await db
      .select()
      .from(salaryPeriods)
      .orderBy(desc(salaryPeriods.endDate))
      .limit(1);

    const [settings] = await db
      .select()
      .from(salarySettings)
      .limit(1);

    const payrollDay = settings?.payrollDay ?? 25;

    let startDate: Date;
    let endDate: Date;
    let name: string;

    if (!latestPeriod) {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), payrollDay);
      endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, payrollDay - 1);
      name = `${endDate.toLocaleString("default", { month: "long" })} ${endDate.getFullYear()}`;
    } else {
      const latestEnd = new Date(latestPeriod.endDate);
      startDate = new Date(latestEnd.getFullYear(), latestEnd.getMonth(), payrollDay);
      if (startDate.getTime() <= latestPeriod.endDate) {
        startDate = new Date(latestEnd.getFullYear(), latestEnd.getMonth() + 1, payrollDay);
      }
      endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, payrollDay - 1);
      name = `${endDate.toLocaleString("default", { month: "long" })} ${endDate.getFullYear()}`;
    }

    // Check if this period already exists
    const startMs = startDate.getTime();
    const [existing] = await db
      .select()
      .from(salaryPeriods)
      .where(eq(salaryPeriods.startDate, startMs))
      .limit(1);

    if (existing) {
      reply.code(409).send({ error: "Period for this month already exists" });
      return;
    }

    try {
      await assertNoPeriodOverlap(startMs, endDate.getTime());
    } catch (error) {
      return reply.code(409).send({ error: (error as Error).message });
    }
    const period = db.transaction((tx) => {
      const inserted = (tx.insert(salaryPeriods).values({
        name,
        startDate: startMs,
        endDate: endDate.getTime(),
      }).returning().all() as any[])[0];
      if (!inserted) throw new Error("Failed to create period");
      bumpFinancialRevisionSync(tx);
      return inserted;
    });

    reply.code(201).send(period);
  });
}
