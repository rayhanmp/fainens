import type { FastifyInstance } from "fastify";

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
import { salaryPeriods } from "../db/schema";
import { getNetWorthTrend, type NetWorthRange } from "../services/analytics";

export default async function (fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // Get net worth
  fastify.get("/api/analytics/net-worth", async () => {
    const data = await getNetWorthCached();
    return data;
  });

  /** Historical net worth (rolling from today). Query: range=7d|30d|3m|6m|1y */
  fastify.get("/api/analytics/net-worth-trend", async (request, reply) => {
    const q = request.query as { range?: string };
    const r = (q.range ?? "30d").toLowerCase();
    const valid: NetWorthRange[] = ["7d", "30d", "3m", "6m", "1y"];
    if (!valid.includes(r as NetWorthRange)) {
      reply.code(400).send({ error: "Invalid range (use 7d, 30d, 3m, 6m, 1y)" });
      return;
    }
    return getNetWorthTrend(r as NetWorthRange);
  });

  // Get burn rate
  fastify.get("/api/analytics/burn-rate", async () => {
    const data = await getBurnRateCached();
    return data;
  });

  // Get runway
  fastify.get("/api/analytics/runway", async () => {
    const data = await getRunwayCached();
    return data;
  });

  // Get trial balance
  fastify.get("/api/analytics/trial-balance", async () => {
    const data = await getTrialBalanceCached();
    return data;
  });

  // Get all analytics in one call
  fastify.get("/api/analytics/dashboard", async () => {
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
  fastify.get("/api/analytics/account-balance/:accountId", async (request, reply) => {
    const { accountId } = request.params as { accountId: string };

    try {
      const balance = await getAccountBalanceCached(parseInt(accountId));
      return { accountId: parseInt(accountId), balance };
    } catch (err) {
      reply.code(404).send({ error: "Account not found" });
    }
  });

  // Get period summary
  fastify.get("/api/analytics/period-summary/:periodId", async (request, reply) => {
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
  fastify.get("/api/analytics/lifestyle-creep", async () => {
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
  fastify.get("/api/analytics/opportunity-cost", async () => {
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
  fastify.get("/api/analytics/period-summaries", async () => {
    const periods = await db.select().from(salaryPeriods);

    const summaries = await Promise.all(
      periods.map(async (period) => {
        const cached = await cacheGet(Keys.periodSummary(period.id));
        if (cached) {
          return { periodId: period.id, periodName: period.name, ...cached };
        }

        try {
          const computed = await precomputePeriodSummary(period.id);
          const { periodId: _, ...computedData } = computed as any;
          return { periodId: period.id, periodName: period.name, ...computedData };
        } catch {
          return { periodId: period.id, periodName: period.name, error: "Failed to compute" };
        }
      }),
    );

    return summaries;
  });
}
