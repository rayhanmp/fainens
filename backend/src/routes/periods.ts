import { eq, desc, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { salaryPeriods, budgetPlans, categories } from "../db/schema";
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

    if (!latestPeriod) {
      // No periods yet, suggest current month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      return {
        suggestedName: `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`,
        suggestedStartDate: startOfMonth.toISOString().split("T")[0],
        suggestedEndDate: endOfMonth.toISOString().split("T")[0],
      };
    }

    // Suggest period starting the day after the latest period ends
    const suggestedStart = new Date(latestPeriod.endDate + 24 * 60 * 60 * 1000);
    const suggestedEnd = new Date(suggestedStart.getFullYear(), suggestedStart.getMonth() + 1, 0);

    return {
      suggestedName: `${suggestedStart.toLocaleString("default", { month: "long" })} ${suggestedStart.getFullYear()}`,
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

    let startDate: Date;
    let endDate: Date;
    let name: string;

    if (!latestPeriod) {
      // Create first period for current month
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      name = `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`;
    } else {
      // Create period starting day after latest ends
      startDate = new Date(latestPeriod.endDate + 24 * 60 * 60 * 1000);
      endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      name = `${startDate.toLocaleString("default", { month: "long" })} ${startDate.getFullYear()}`;
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
