import { eq, desc, sql, and } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { salaryPeriods, budgetPlans, categories, salarySettings, transactions, auditLogs } from "../db/schema";
import { precomputePeriodSummary } from "../cache/precompute";
import { bumpFinancialRevisionSync } from "../services/financial-revision";
import { inclusivePeriodEnd } from "../services/period-locking";
import { firstPayrollStartAfter, followingPayrollStart, payrollPeriodEnd } from "../services/period-cadence";

const MAX_RETURN_BACKFILL_PERIODS = 120;

const periodIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
// Keep the wire representation as a string because the legacy handler checks
// explicitly for `"true"`. `z.coerce.boolean()` would treat the string
// `"false"` as truthy and accidentally expose archived periods.
const periodListQuerySchema = z.object({ includeInactive: z.enum(["true", "false"]).optional() });
const periodErrorSchema = z.object({ error: z.string() }).passthrough();
const periodSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  startDate: z.number(),
  endDate: z.number(),
  status: z.enum(["open", "closed"]),
  closedAt: z.union([z.date(), z.string(), z.number()]).nullable().optional(),
  reopenedAt: z.union([z.date(), z.string(), z.number()]).nullable().optional(),
  isActive: z.boolean(),
  archivedAt: z.union([z.date(), z.string(), z.number()]).nullable().optional(),
  coverageStatus: z.enum(["complete", "partial", "skipped", "unknown"]),
  coverageReason: z.string().nullable().optional(),
}).passthrough();
const periodSummarySchema = z.unknown().nullable();
const periodBudgetSchema = z.object({
  id: z.number().int(),
  categoryId: z.number().int(),
  plannedAmount: z.number(),
  categoryName: z.string(),
}).passthrough();
const periodDetailSchema = periodSchema.extend({
  summary: periodSummarySchema,
  budgets: z.array(periodBudgetSchema),
});
const returnPreviewSchema = z.object({
  candidates: z.array(z.object({
    name: z.string(),
    startDate: z.number(),
    endDate: z.number(),
    isCurrent: z.boolean(),
  })),
  payrollDay: z.number().int().optional(),
  reason: z.string().optional(),
});
const returnBackfillBodySchema = z.object({
  asOfDate: z.number().int().nonnegative().optional(),
  confirmed: z.literal(true),
  currentPeriodCoverage: z.enum(["partial", "complete"]).optional(),
  reviewedCurrentPeriod: z.boolean().optional(),
});
const returnBackfillResponseSchema = z.object({
  periods: z.array(periodSchema),
  message: z.string(),
});
const periodCreateBodySchema = z.object({
  name: z.string().trim().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});
const periodUpdateBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
});
const periodMutationResponses = {
  200: periodSchema,
  201: periodSchema,
  400: periodErrorSchema,
  404: periodErrorSchema,
  409: periodErrorSchema,
};

type ReturnPeriodCandidate = { name: string; startDate: number; endDate: number; isCurrent: boolean };

function payrollPeriod(startDate: number, payrollDay: number, asOfDate: number): ReturnPeriodCandidate {
  const endDate = payrollPeriodEnd(startDate, payrollDay);
  const end = new Date(endDate);
  return {
    name: `${end.toLocaleString("default", { month: "long" })} ${end.getFullYear()}`,
    startDate,
    endDate,
    isCurrent: asOfDate <= inclusivePeriodEnd(endDate),
  };
}

async function buildReturnBackfillPreview(asOfDate: number): Promise<{ candidates: ReturnPeriodCandidate[]; payrollDay?: number; reason?: string }> {
  const [latest] = await db.select({ endDate: salaryPeriods.endDate })
    .from(salaryPeriods).orderBy(desc(salaryPeriods.endDate)).limit(1);
  if (!latest) {
    return { candidates: [], reason: "No prior accounting period exists, so the product cannot infer a safe missing-period cadence." };
  }
  const [settings] = await db.select({ payrollDay: salarySettings.payrollDay }).from(salarySettings).limit(1);
  const payrollDay = settings?.payrollDay ?? 25;
  let nextStart = firstPayrollStartAfter(Number(latest.endDate), payrollDay);
  if (nextStart > asOfDate) return { candidates: [] };
  const candidates: ReturnPeriodCandidate[] = [];
  while (nextStart <= asOfDate && candidates.length < MAX_RETURN_BACKFILL_PERIODS) {
    const candidate = payrollPeriod(nextStart, payrollDay, asOfDate);
    candidates.push(candidate);
    nextStart = followingPayrollStart(candidate.startDate, payrollDay);
  }
  if (nextStart <= asOfDate) {
    return { candidates: [], reason: `Refusing to infer more than ${MAX_RETURN_BACKFILL_PERIODS} periods at once.` };
  }
  return { candidates, payrollDay };
}

async function assertNoPeriodOverlap(startMs: number, endMs: number, excludeId?: number): Promise<void> {
  const periods = await db.select({ id: salaryPeriods.id, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
    .from(salaryPeriods);
  const overlap = periods.find((period) => period.id !== excludeId &&
    startMs <= inclusivePeriodEnd(Number(period.endDate)) && Number(period.startDate) <= inclusivePeriodEnd(endMs));
  if (overlap) throw new Error(`Period overlaps existing period ${overlap.id}`);
}

export default async function (fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // List all salary periods
  fastify.get("/api/periods", {
    schema: {
      operationId: "listPeriods",
      tags: ["periods"],
      querystring: periodListQuerySchema,
      response: { 200: z.array(periodSchema) },
    },
  }, async (request) => {
    const includeInactive = (request.query as { includeInactive?: string }).includeInactive === "true";
    const periods = await db
      .select()
      .from(salaryPeriods)
      .where(includeInactive ? undefined : eq(salaryPeriods.isActive, true))
      .orderBy(desc(salaryPeriods.startDate));

    return periods;
  });

  // Get single period with summary
  fastify.get("/api/periods/:id", {
    schema: {
      operationId: "getPeriod",
      tags: ["periods"],
      params: periodIdParamsSchema,
      response: { 200: periodDetailSchema, 404: periodErrorSchema },
    },
  }, async (request, reply) => {
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

  // Read-only first step of the return-after-absence workflow. Nothing is
  // created merely by opening a screen or calling this endpoint.
  fastify.get("/api/periods/return-preview", {
    schema: {
      operationId: "previewPeriodReturn",
      tags: ["periods"],
      querystring: z.object({ asOfDate: z.coerce.number().int().nonnegative().optional() }),
      response: { 200: returnPreviewSchema, 400: periodErrorSchema },
    },
  }, async (request, reply) => {
    const rawAsOf = (request.query as { asOfDate?: string }).asOfDate;
    const asOfDate = rawAsOf == null ? Date.now() : Number(rawAsOf);
    if (!Number.isSafeInteger(asOfDate) || asOfDate < 0 || asOfDate > Date.now()) {
      return reply.code(400).send({ error: "asOfDate must be a current or historical timestamp" });
    }
    return buildReturnBackfillPreview(asOfDate);
  });

  // Explicitly create missing historical period headers as skipped coverage.
  // The active return period is normally partial. A user who resumed at its
  // start can explicitly attest that the whole period is captured and mark
  // that one current period complete while creating the return shells.
  fastify.post("/api/periods/return-backfill", {
    schema: {
      operationId: "createPeriodReturnBackfill",
      tags: ["periods"],
      body: returnBackfillBodySchema,
      response: {
        200: returnBackfillResponseSchema,
        201: returnBackfillResponseSchema,
        400: periodErrorSchema,
        409: periodErrorSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      asOfDate?: number;
      confirmed?: boolean;
      currentPeriodCoverage?: "partial" | "complete";
      reviewedCurrentPeriod?: boolean;
    };
    if (body.confirmed !== true) {
      return reply.code(400).send({ error: "confirmed: true is required to create skipped period shells" });
    }
    const asOfDate = body.asOfDate ?? Date.now();
    if (!Number.isSafeInteger(asOfDate) || asOfDate < 0 || asOfDate > Date.now()) {
      return reply.code(400).send({ error: "asOfDate must be a current or historical timestamp" });
    }
    const currentPeriodCoverage = body.currentPeriodCoverage ?? "partial";
    if (currentPeriodCoverage !== "partial" && currentPeriodCoverage !== "complete") {
      return reply.code(400).send({ error: "currentPeriodCoverage must be partial or complete" });
    }
    if (currentPeriodCoverage === "complete" && body.reviewedCurrentPeriod !== true) {
      return reply.code(400).send({ error: "reviewedCurrentPeriod: true is required to mark the current return period complete" });
    }
    const preview = await buildReturnBackfillPreview(asOfDate);
    if (preview.reason) return reply.code(409).send({ error: preview.reason });
    if (preview.candidates.length === 0) return reply.send({ periods: [], message: "No missing periods to create" });
    try {
      const created = db.transaction((tx) => {
        const existing = tx.select({ id: salaryPeriods.id, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
          .from(salaryPeriods).all();
        for (const candidate of preview.candidates) {
          const overlap = existing.some((period: any) => candidate.startDate <= inclusivePeriodEnd(Number(period.endDate)) && Number(period.startDate) <= inclusivePeriodEnd(candidate.endDate));
          if (overlap) throw new Error("Accounting periods changed while preparing return backfill; review and retry");
        }
        const now = new Date();
        const inserted = preview.candidates.map((candidate) => {
          const status = candidate.isCurrent ? "open" : "closed";
          const coverageStatus = candidate.isCurrent ? currentPeriodCoverage : "skipped";
          const coverageReason = candidate.isCurrent
            ? currentPeriodCoverage === "complete" ? "return_started_at_period_start" : "return_started_current_period"
            : "return_after_absence";
          const row = tx.insert(salaryPeriods).values({
            name: candidate.name,
            startDate: candidate.startDate,
            endDate: candidate.endDate,
            status,
            closedAt: candidate.isCurrent ? null : now,
            coverageStatus,
            coverageReason,
          }).returning().all()[0];
          if (!row) throw new Error("Failed to create return period shell");
          tx.insert(auditLogs).values({
            entityType: "salary_period",
            entityId: row.id,
            action: candidate.isCurrent
              ? currentPeriodCoverage === "complete" ? "create_complete_return_current_period" : "create_return_current_period"
              : "create_skipped_return_period",
            afterSnapshot: Buffer.from(JSON.stringify(row)),
          }).run();
          return row;
        });
        bumpFinancialRevisionSync(tx);
        return inserted;
      });
      const currentPeriodMessage = currentPeriodCoverage === "complete"
        ? "the current period was marked complete based on your reviewed start-of-period return"
        : "the active return period is partial until reviewed";
      return reply.code(201).send({ periods: created, message: `Historical gaps were created as skipped; ${currentPeriodMessage}. No transactions or budgets were fabricated.` });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Failed to create skipped period shells" });
    }
  });

  // Create salary period
  fastify.post("/api/periods", {
    schema: {
      operationId: "createPeriod",
      tags: ["periods"],
      body: periodCreateBodySchema,
      response: periodMutationResponses,
    },
  }, async (request, reply) => {
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
  fastify.patch("/api/periods/:id", {
    schema: {
      operationId: "updatePeriod",
      tags: ["periods"],
      params: periodIdParamsSchema,
      body: periodUpdateBodySchema,
      response: periodMutationResponses,
    },
  }, async (request, reply) => {
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
    if (existing.status === "closed") {
      reply.code(409).send({ error: "Period is closed; reopen it before changing dates or name" });
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

    const boundariesChanged = startMs !== existing.startDate || endMs !== existing.endDate;
    if (boundariesChanged) {
      // Period identity is referenced by posted journals and budget plans. A
      // date-boundary edit must never silently reframe a period that already
      // has financial history. Rename it freely; create a corrective period
      // instead when recorded activity exists.
      const [postedTransaction] = await db.select({ id: transactions.id }).from(transactions)
        .where(and(eq(transactions.periodId, parseInt(id)), sql`${transactions.status} <> 'draft'`)).limit(1);
      if (postedTransaction) {
        reply.code(409).send({ error: "This period has posted transactions. Its dates are locked to protect recorded history." });
        return;
      }
      const [budgetPlan] = await db.select({ id: budgetPlans.id }).from(budgetPlans)
        .where(eq(budgetPlans.periodId, parseInt(id))).limit(1);
      if (budgetPlan) {
        reply.code(409).send({ error: "This period has budget plans. Remove or move those plans before changing its dates." });
        return;
      }
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

  // Coverage is a separate, deliberately reviewed assertion. It must never be
  // inferred from an empty transaction list or from closing a period.
  fastify.post("/api/periods/:id/coverage", async (request, reply) => {
    const periodId = Number((request.params as { id: string }).id);
    const body = request.body as { coverageStatus?: string; reason?: string; reviewed?: boolean };
    const coverageStatus = body.coverageStatus;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!Number.isSafeInteger(periodId) || periodId <= 0) return reply.code(400).send({ error: "Invalid period ID" });
    if (coverageStatus !== "partial" && coverageStatus !== "complete" && coverageStatus !== "skipped") {
      return reply.code(400).send({ error: "coverageStatus must be partial, complete, or skipped" });
    }
    if (reason.length < 3 || reason.length > 500) return reply.code(400).send({ error: "A coverage review reason of 3-500 characters is required" });
    if ((coverageStatus === "complete" || coverageStatus === "skipped") && body.reviewed !== true) {
      return reply.code(400).send({ error: `reviewed: true is required before marking coverage ${coverageStatus}` });
    }
    try {
      const updated = db.transaction((tx) => {
        const period = tx.select().from(salaryPeriods).where(eq(salaryPeriods.id, periodId)).limit(1).all()[0];
        if (!period) throw new Error("Period not found");
        // A skipped period is an explicit statement that there was no tracked
        // activity. Never let that hide already-posted journals or a budget.
        if (coverageStatus === "skipped") {
          const [postedTransaction] = tx.select({ id: transactions.id }).from(transactions)
            .where(and(eq(transactions.periodId, periodId), sql`${transactions.status} <> 'draft'`)).limit(1).all();
          if (postedTransaction) throw new Error("A period with posted activity cannot be marked skipped. Use partial instead.");
          const [budgetPlan] = tx.select({ id: budgetPlans.id }).from(budgetPlans)
            .where(eq(budgetPlans.periodId, periodId)).limit(1).all();
          if (budgetPlan) throw new Error("A period with budget plans cannot be marked skipped. Remove or move its budget plans first.");
        }
        const row = tx.update(salaryPeriods).set({ coverageStatus, coverageReason: reason })
          .where(eq(salaryPeriods.id, periodId)).returning().all()[0];
        tx.insert(auditLogs).values({ entityType: "salary_period", entityId: periodId, action: "set_coverage", beforeSnapshot: Buffer.from(JSON.stringify(period)), afterSnapshot: Buffer.from(JSON.stringify(row)) }).run();
        bumpFinancialRevisionSync(tx);
        return row;
      });
      return reply.send(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update period coverage";
      return reply.code(message === "Period not found" ? 404 : 409).send({ error: message });
    }
  });

  // Close a completed accounting period. Closing is deliberate, audited, and
  // blocks any new/backdated journal in the period at the database layer.
  fastify.post("/api/periods/:id/close", async (request, reply) => {
    const periodId = Number((request.params as { id: string }).id);
    if (!Number.isSafeInteger(periodId) || periodId <= 0) {
      return reply.code(400).send({ error: "Invalid period ID" });
    }
    try {
      const now = Date.now();
      const closed = db.transaction((tx) => {
        const period = tx.select().from(salaryPeriods).where(eq(salaryPeriods.id, periodId)).limit(1).all()[0];
        if (!period) throw new Error("Period not found");
        if (period.status === "closed") throw new Error("Period is already closed");

        // Drafts are not part of statements, but allowing them to survive a
        // close would make their eventual posting ambiguous.
        const draft = tx.select({ id: transactions.id }).from(transactions)
          .where(and(
            eq(transactions.status, "draft"),
            sql`(${transactions.periodId} = ${periodId} OR (${transactions.date} >= ${period.startDate} AND ${transactions.date} <= ${inclusivePeriodEnd(Number(period.endDate))}))`,
          ))
          .limit(1).all()[0];
        if (draft) throw new Error(`Resolve or remove draft transaction ${draft.id} before closing this period`);

        const updated = tx.update(salaryPeriods)
          .set({ status: "closed", closedAt: new Date(now), reopenedAt: null })
          .where(and(eq(salaryPeriods.id, periodId), eq(salaryPeriods.status, "open")))
          .returning().all()[0];
        if (!updated) throw new Error("Period was changed; retry closing it");
        tx.insert(auditLogs).values({
          entityType: "salary_period",
          entityId: periodId,
          action: "close",
          beforeSnapshot: Buffer.from(JSON.stringify(period)),
          afterSnapshot: Buffer.from(JSON.stringify(updated)),
        }).run();
        bumpFinancialRevisionSync(tx);
        return updated;
      });
      return reply.send(closed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to close period";
      return reply.code(message === "Period not found" ? 404 : 409).send({ error: message });
    }
  });

  // Reopening is explicit and audited. It is required before historical
  // correction entries or budget/date changes can be made.
  fastify.post("/api/periods/:id/reopen", async (request, reply) => {
    const periodId = Number((request.params as { id: string }).id);
    if (!Number.isSafeInteger(periodId) || periodId <= 0) {
      return reply.code(400).send({ error: "Invalid period ID" });
    }
    try {
      const now = Date.now();
      const reopened = db.transaction((tx) => {
        const period = tx.select().from(salaryPeriods).where(eq(salaryPeriods.id, periodId)).limit(1).all()[0];
        if (!period) throw new Error("Period not found");
        if (period.status !== "closed") throw new Error("Only a closed period can be reopened");
        const updated = tx.update(salaryPeriods)
          .set({ status: "open", reopenedAt: new Date(now) })
          .where(and(eq(salaryPeriods.id, periodId), eq(salaryPeriods.status, "closed")))
          .returning().all()[0];
        if (!updated) throw new Error("Period was changed; retry reopening it");
        tx.insert(auditLogs).values({
          entityType: "salary_period",
          entityId: periodId,
          action: "reopen",
          beforeSnapshot: Buffer.from(JSON.stringify(period)),
          afterSnapshot: Buffer.from(JSON.stringify(updated)),
        }).run();
        bumpFinancialRevisionSync(tx);
        return updated;
      });
      return reply.send(reopened);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reopen period";
      return reply.code(message === "Period not found" ? 404 : 409).send({ error: message });
    }
  });

  fastify.post("/api/periods/:id/archive", async (request, reply) => {
    const periodId = Number((request.params as { id?: string }).id);
    if (!Number.isSafeInteger(periodId) || periodId <= 0) return reply.code(400).send({ error: "Invalid period ID" });
    try {
      const archived = db.transaction((tx) => {
        const period = tx.select().from(salaryPeriods).where(eq(salaryPeriods.id, periodId)).limit(1).all()[0];
        if (!period) throw new Error("Period not found");
        if (!period.isActive) throw new Error("Period is already archived");
        if (period.status !== "closed") throw new Error("Close a period before archiving it");
        const updated = tx.update(salaryPeriods).set({ isActive: false, archivedAt: new Date() })
          .where(and(eq(salaryPeriods.id, periodId), eq(salaryPeriods.isActive, true))).returning().all()[0];
        if (!updated) throw new Error("Period changed; retry archive");
        tx.insert(auditLogs).values({ entityType: "salary_period", entityId: periodId, action: "archive", beforeSnapshot: Buffer.from(JSON.stringify(period)), afterSnapshot: Buffer.from(JSON.stringify(updated)) }).run();
        bumpFinancialRevisionSync(tx); return updated;
      });
      return reply.send(archived);
    } catch (error) { const message = error instanceof Error ? error.message : "Failed to archive period"; return reply.code(message === "Period not found" ? 404 : 409).send({ error: message }); }
  });

  fastify.post("/api/periods/:id/restore", async (request, reply) => {
    const periodId = Number((request.params as { id?: string }).id);
    if (!Number.isSafeInteger(periodId) || periodId <= 0) return reply.code(400).send({ error: "Invalid period ID" });
    try {
      const restored = db.transaction((tx) => {
        const period = tx.select().from(salaryPeriods).where(eq(salaryPeriods.id, periodId)).limit(1).all()[0];
        if (!period) throw new Error("Period not found");
        if (period.isActive) throw new Error("Period is already active");
        const updated = tx.update(salaryPeriods).set({ isActive: true, archivedAt: null })
          .where(and(eq(salaryPeriods.id, periodId), eq(salaryPeriods.isActive, false))).returning().all()[0];
        if (!updated) throw new Error("Period changed; retry restore");
        tx.insert(auditLogs).values({ entityType: "salary_period", entityId: periodId, action: "restore", beforeSnapshot: Buffer.from(JSON.stringify(period)), afterSnapshot: Buffer.from(JSON.stringify(updated)) }).run();
        bumpFinancialRevisionSync(tx); return updated;
      });
      return reply.send(restored);
    } catch (error) { const message = error instanceof Error ? error.message : "Failed to restore period"; return reply.code(message === "Period not found" ? 404 : 409).send({ error: message }); }
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
    if (existing.status === "closed") {
      reply.code(409).send({ error: "Period is closed; reopen it before deletion" });
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
