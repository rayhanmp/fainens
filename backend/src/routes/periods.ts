import { eq, desc, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { salaryPeriods, budgetPlans, categories, salarySettings } from "../db/schema";
import { precomputePeriodSummary } from "../cache/precompute";

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

    if (endMs <= startMs) {
      reply.code(400).send({ error: "End date must be after start date" });
      return;
    }

    const [period] = await db
      .insert(salaryPeriods)
      .values({
        name: body.name,
        startDate: startMs,
        endDate: endMs,
      })
      .returning();

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

    if (body.name) updates.name = body.name;
    if (body.startDate) updates.startDate = new Date(body.startDate).getTime();
    if (body.endDate) updates.endDate = new Date(body.endDate).getTime();

    // Validate date range if both dates are being updated or one is updated
    const startMs = updates.startDate ?? existing.startDate;
    const endMs = updates.endDate ?? existing.endDate;

    if (endMs <= startMs) {
      reply.code(400).send({ error: "End date must be after start date" });
      return;
    }

    const [updated] = await db
      .update(salaryPeriods)
      .set(updates)
      .where(eq(salaryPeriods.id, parseInt(id)))
      .returning();

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

    // Budget plans for this period will be cascade deleted
    await db.delete(salaryPeriods).where(eq(salaryPeriods.id, parseInt(id)));

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

    const [period] = await db
      .insert(salaryPeriods)
      .values({
        name,
        startDate: startMs,
        endDate: endDate.getTime(),
      })
      .returning();

    reply.code(201).send(period);
  });
}
