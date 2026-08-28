import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  getNetWorthCached,
  getBurnRateCached,
  getRunwayCached,
  getTrialBalanceCached,
  getAccountBalanceCached,
} from "../cache/invalidation";
import { cacheGet } from "../cache/redis";
import { Keys, ANALYTICS_KEYS } from "../cache/keys";
import { precomputePeriodSummary } from "../cache/precompute";
import { db } from "../db/client";
import { asc } from "drizzle-orm";
import { salaryPeriods } from "../db/schema";
import { getNetWorthTrend, getSpendingTrend, type NetWorthRange } from "../services/analytics";

const analyticsErrorSchema = z.object({ error: z.string() }).passthrough();
const netWorthSchema = z.object({ totalAssets: z.number(), totalLiabilities: z.number(), netWorth: z.number() }).passthrough();
const burnRateSchema = z.object({ grossBurnRate: z.number(), period: z.string() }).passthrough();
const runwaySchema = z.object({ runwayMonths: z.number().nullable(), isUnbounded: z.boolean(), liquidAssets: z.number() }).passthrough();
const trialBalanceSchema = z.object({ totalDebits: z.number(), totalCredits: z.number(), isBalanced: z.boolean() }).passthrough();
const rangeQuerySchema = z.object({ range: z.enum(["7d", "30d", "3m", "6m", "1y"]).optional() });
const spendingTrendQuerySchema = z.object({ periodId: z.string().regex(/^\d+$/).optional() });
const analyticsIdParamsSchema = z.object({ accountId: z.coerce.number().int().positive() });
const periodSummaryParamsSchema = z.object({ periodId: z.coerce.number().int().positive() });
const spendingTrendPointSchema = z.object({
  label: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  spent: z.number(),
  transactionCount: z.number().int(),
  coverageStatus: z.enum(["complete", "partial", "skipped", "unknown"]),
}).passthrough();
const spendingTrendSchema = z.object({
  range: z.enum(["30d", "period"]),
  periodId: z.number().int().nullable(),
  periodName: z.string().nullable(),
  startMs: z.number(),
  endMs: z.number(),
  bucketCount: z.number().int(),
  totalSpent: z.number(),
  averageDailySpend: z.number(),
  hasIncompleteCoverage: z.boolean(),
  series: z.array(spendingTrendPointSchema),
}).passthrough();
const netWorthTrendPointSchema = z.object({
  label: z.string(),
  asOfMs: z.number(),
  netWorth: z.number(),
  totalAssets: z.number(),
  totalLiabilities: z.number(),
}).passthrough();
const netWorthTrendSchema = z.object({
  range: z.enum(["7d", "30d", "3m", "6m", "1y"]),
  bucketCount: z.number().int(),
  series: z.array(netWorthTrendPointSchema),
}).passthrough();
const dashboardAnalyticsSchema = z.object({
  netWorth: netWorthSchema,
  burnRate: burnRateSchema,
  runway: runwaySchema,
  trialBalance: trialBalanceSchema,
}).passthrough();

export default async function (fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // Get net worth
  fastify.get("/api/analytics/net-worth", {
    schema: { operationId: "getNetWorth", tags: ["analytics"], response: { 200: netWorthSchema } },
  }, async () => {
    const data = await getNetWorthCached();
    return data;
  });

  /** Historical net worth (rolling from today). Query: range=7d|30d|3m|6m|1y */
  fastify.get("/api/analytics/net-worth-trend", {
    schema: { operationId: "getNetWorthTrend", tags: ["analytics"], querystring: rangeQuerySchema, response: { 200: netWorthTrendSchema, 400: analyticsErrorSchema } },
  }, async (request, reply) => {
    const q = request.query as { range?: string };
    const r = (q.range ?? "30d").toLowerCase();
    const valid: NetWorthRange[] = ["7d", "30d", "3m", "6m", "1y"];
    if (!valid.includes(r as NetWorthRange)) {
      reply.code(400).send({ error: "Invalid range (use 7d, 30d, 3m, 6m, 1y)" });
      return;
    }
    return getNetWorthTrend(r as NetWorthRange);
  });

  /** Daily posted expense activity for the rolling window or one salary period. */
  fastify.get("/api/analytics/spending-trend", {
    schema: { operationId: "getSpendingTrend", tags: ["analytics"], querystring: spendingTrendQuerySchema, response: { 200: spendingTrendSchema, 400: analyticsErrorSchema, 500: analyticsErrorSchema } },
  }, async (request, reply) => {
    try {
      const query = request.query as { periodId?: string };
      const periodId = query.periodId == null || query.periodId.trim() === "" ? undefined : Number(query.periodId);
      if (periodId != null && (!Number.isSafeInteger(periodId) || periodId <= 0)) {
        return reply.code(400).send({ error: "Invalid periodId" });
      }
      return await getSpendingTrend(30, periodId);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: "Failed to load spending trend" });
    }
  });

  // Get burn rate
  fastify.get("/api/analytics/burn-rate", {
    schema: { operationId: "getBurnRate", tags: ["analytics"], response: { 200: burnRateSchema } },
  }, async () => {
    const data = await getBurnRateCached();
    return data;
  });

  // Get runway
  fastify.get("/api/analytics/runway", {
    schema: { operationId: "getRunway", tags: ["analytics"], response: { 200: runwaySchema } },
  }, async () => {
    const data = await getRunwayCached();
    return data;
  });

  // Get trial balance
  fastify.get("/api/analytics/trial-balance", {
    schema: { operationId: "getTrialBalance", tags: ["analytics"], response: { 200: trialBalanceSchema } },
  }, async () => {
    const data = await getTrialBalanceCached();
    return data;
  });

  // Get all analytics in one call
  fastify.get("/api/analytics/dashboard", {
    schema: { operationId: "getDashboardAnalytics", tags: ["analytics"], response: { 200: dashboardAnalyticsSchema } },
  }, async () => {
    const [netWorth, burnRate, runway, trialBalance] = await Promise.all([
      getNetWorthCached(),
      getBurnRateCached(),
      getRunwayCached(),
      getTrialBalanceCached(),
    ]);

    return {
      netWorth,
      burnRate,
      runway,
      trialBalance,
    };
  });

  // Get account balance (from cache)
  fastify.get("/api/analytics/account-balance/:accountId", {
    schema: { operationId: "getAccountBalance", tags: ["analytics"], params: analyticsIdParamsSchema, response: { 200: z.object({ accountId: z.number().int(), balance: z.number() }).passthrough(), 404: analyticsErrorSchema } },
  }, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };

    try {
      const balance = await getAccountBalanceCached(parseInt(accountId));
      return { accountId: parseInt(accountId), balance };
    } catch (err) {
      reply.code(404).send({ error: "Account not found" });
    }
  });

  // Get period summary
  fastify.get("/api/analytics/period-summary/:periodId", {
    schema: { operationId: "getPeriodSummary", tags: ["analytics"], params: periodSummaryParamsSchema, response: { 200: z.unknown(), 404: analyticsErrorSchema } },
  }, async (request, reply) => {
    const { periodId } = request.params as { periodId: string };

    // Check cache first
    const cached = await cacheGet(Keys.periodSummary(parseInt(periodId)));
    if (cached) {
      return cached;
    }

    // Compute if not cached
    try {
      const data = await precomputePeriodSummary(parseInt(periodId));
      return data;
    } catch (err) {
      reply.code(404).send({ error: "Period not found" });
    }
  });

  // Get lifestyle creep index (placeholder - to be implemented in Phase 8)
  fastify.get("/api/analytics/lifestyle-creep", {
    schema: { operationId: "getLifestyleCreep", tags: ["analytics"], response: { 200: z.object({ mpc: z.number(), trend: z.string(), periods: z.array(z.unknown()), computedAt: z.number() }).passthrough() } },
  }, async () => {
    const cached = await cacheGet(Keys.analytics(ANALYTICS_KEYS.LIFESTYLE_CREEP));

    if (cached) {
      return cached;
    }

    // Placeholder response
    return {
      mpc: 0,
      trend: "stable",
      periods: [],
      computedAt: Date.now(),
    };
  });

  // Get opportunity cost (placeholder - to be implemented in Phase 8)
  fastify.get("/api/analytics/opportunity-cost", {
    schema: { operationId: "getOpportunityCost", tags: ["analytics"], response: { 200: z.object({ cumulativeWealthErosion: z.number(), flaggedTransactions: z.array(z.unknown()), baselineYieldBps: z.number(), computedAt: z.number() }).passthrough() } },
  }, async () => {
    const cached = await cacheGet(Keys.analytics(ANALYTICS_KEYS.OPPORTUNITY_COST));

    if (cached) {
      return cached;
    }

    // Placeholder response
    return {
      cumulativeWealthErosion: 0,
      flaggedTransactions: [],
      baselineYieldBps: 400, // 4%
      computedAt: Date.now(),
    };
  });

  // Get all periods summaries
  fastify.get("/api/analytics/period-summaries", {
    schema: { operationId: "listPeriodSummaries", tags: ["analytics"], response: { 200: z.array(z.object({ periodId: z.number().int(), periodName: z.string(), startDate: z.number(), endDate: z.number() }).passthrough()) } },
  }, async () => {
    const periods = await db.select().from(salaryPeriods).orderBy(asc(salaryPeriods.startDate));

    const summaries = await Promise.all(
      periods.map(async (period) => {
        const cached = await cacheGet(Keys.periodSummary(period.id));
        if (cached) {
          return { periodId: period.id, periodName: period.name, startDate: period.startDate, endDate: period.endDate, ...cached };
        }

        try {
          const computed = await precomputePeriodSummary(period.id);
          const { periodId: _, ...computedData } = computed as any;
          return { periodId: period.id, periodName: period.name, startDate: period.startDate, endDate: period.endDate, ...computedData };
        } catch {
          return { periodId: period.id, periodName: period.name, startDate: period.startDate, endDate: period.endDate, error: "Failed to compute" };
        }
      }),
    );

    return summaries;
  });
}
