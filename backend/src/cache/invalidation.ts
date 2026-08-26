import { cacheDelete, cacheDeletePattern, cacheGet, cacheSet } from "./redis";
import { Keys, CACHE_TTL, ANALYTICS_KEYS } from "./keys";
import { bumpFinancialRevision } from "../services/financial-revision";
import { getFinancialRevision } from "../services/financial-revision";
import {
  precomputeAccountBalance,
  precomputeNetWorth,
  precomputeBurnRate,
  precomputeRunway,
  precomputeTrialBalance,
  precomputePeriodSummary,
} from "./precompute";

// Invalidate a single account balance and trigger recomputation
export async function invalidateAccountBalance(accountId: number): Promise<boolean> {
  return cacheDelete(Keys.accountBalance(accountId));
}

// Invalidate all account balances
export async function invalidateAllAccountBalances(): Promise<boolean> {
  return cacheDeletePattern(Keys.allAccountBalances());
}

// Invalidate period summary
export async function invalidatePeriodSummary(periodId: number): Promise<boolean> {
  return cacheDelete(Keys.periodSummary(periodId));
}

// Invalidate all period summaries
export async function invalidateAllPeriodSummaries(): Promise<boolean> {
  return cacheDeletePattern(Keys.allPeriodSummaries());
}

// Invalidate all analytics
export async function invalidateAllAnalytics(): Promise<boolean> {
  return cacheDeletePattern(Keys.allAnalytics());
}

export async function invalidateAllInsights(): Promise<boolean> {
  return cacheDeletePattern("insights:*");
}

// Invalidate everything (nuclear option)
export async function invalidateEverything(): Promise<boolean> {
  const results = await Promise.all([
    invalidateAllAccountBalances(),
    invalidateAllPeriodSummaries(),
    invalidateAllAnalytics(),
    invalidateAllInsights(),
  ]);
  return results.every(Boolean);
}

// Invalidate and recompute a single account balance (synchronous recomputation)
export async function invalidateAndRecomputeAccountBalance(accountId: number): Promise<void> {
  await invalidateAccountBalance(accountId);
  await precomputeAccountBalance(accountId);
}

// Invalidate and recompute all analytics (used after transaction mutations)
export async function invalidateAndRecomputeAnalytics(): Promise<void> {
  await invalidateAllAnalytics();
  await invalidateAllInsights();
  await Promise.all([
    precomputeNetWorth(),
    precomputeBurnRate(),
    precomputeRunway(),
    precomputeTrialBalance(),
  ]);
}

// Smart invalidation pipeline after transaction creation/update/deletion
export interface TransactionMutationContext {
  transactionId: number;
  affectedAccountIds: number[];
  affectedPeriodIds?: number[];
  /** Set when the owning write transaction already bumped the revision. */
  revisionBumped?: boolean;
}

// Main invalidation pipeline - call this after any transaction mutation
export async function invalidateOnTransactionMutation(
  context: TransactionMutationContext,
): Promise<void> {
  // Legacy mutation paths call this after their DB commit. Keep them
  // revision-safe even if Redis invalidation is unavailable. Compound commands
  // bump inside their own transaction and set revisionBumped to avoid a double
  // increment.
  if (!context.revisionBumped) bumpFinancialRevision();
  // 1. Invalidate affected account balances
  for (const accountId of context.affectedAccountIds) {
    await invalidateAccountBalance(accountId);
  }

  // 2. Invalidate analytics (net worth, burn rate, runway, trial balance)
  // These are recomputed lazily on next read, or can be eagerly recomputed
  await invalidateAllAnalytics();

  // 3. Invalidate affected period summaries if periods are known
  if (context.affectedPeriodIds) {
    for (const periodId of context.affectedPeriodIds) {
      await invalidatePeriodSummary(periodId);
    }
  }
}

// Eager recomputation variant - recomputes immediately after invalidation
export async function invalidateAndRecomputeOnTransactionMutation(
  context: TransactionMutationContext,
): Promise<void> {
  // 1. Recompute affected account balances
  for (const accountId of context.affectedAccountIds) {
    await precomputeAccountBalance(accountId);
  }

  // 2. Recompute all analytics
  await Promise.all([
    precomputeNetWorth(),
    precomputeBurnRate(),
    precomputeRunway(),
    precomputeTrialBalance(),
  ]);

  // 3. Recompute affected period summaries
  if (context.affectedPeriodIds) {
    for (const periodId of context.affectedPeriodIds) {
      await precomputePeriodSummary(periodId);
    }
  }
}

// Cache read helpers that fallback to DB on cache miss
export async function getAccountBalanceCached(accountId: number): Promise<number> {
  const cached = await cacheGet<{ balance: number }>(Keys.accountBalance(accountId));
  const revision = await getFinancialRevision();
  if (cached && (cached as { revision?: number }).revision === revision) {
    return cached.balance;
  }

  // Cache miss - compute and store
  const result = await precomputeAccountBalance(accountId);
  return result.balance;
}

export async function getNetWorthCached(): Promise<{
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}> {
  const cached = await cacheGet<{
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
    revision?: number;
  }>(Keys.analytics(ANALYTICS_KEYS.NET_WORTH));

  const revision = await getFinancialRevision();
  if (cached && cached.revision === revision) {
    return cached;
  }

  // Cache miss - compute and store
  const result = await precomputeNetWorth();
  return {
    totalAssets: result.totalAssets,
    totalLiabilities: result.totalLiabilities,
    netWorth: result.netWorth,
  };
}

export async function getBurnRateCached(): Promise<{
  grossBurnRate: number;
  period: string;
}> {
  const cached = await cacheGet<{
    grossBurnRate: number;
    period: string;
    revision?: number;
  }>(Keys.analytics(ANALYTICS_KEYS.BURN_RATE));

  const revision = await getFinancialRevision();
  if (cached && cached.revision === revision) {
    return cached;
  }

  const result = await precomputeBurnRate();
  return {
    grossBurnRate: result.grossBurnRate,
    period: result.period,
  };
}

export async function getRunwayCached(): Promise<{
  runwayMonths: number | null;
  isUnbounded: boolean;
  liquidAssets: number;
}> {
  const cached = await cacheGet<{
    runwayMonths: number | null;
    isUnbounded: boolean;
    liquidAssets: number;
    revision?: number;
  }>(Keys.analytics(ANALYTICS_KEYS.RUNWAY));

  const revision = await getFinancialRevision();
  if (cached && cached.revision === revision && typeof cached.isUnbounded === "boolean") {
    return cached;
  }

  const result = await precomputeRunway();
  return {
    runwayMonths: result.runwayMonths,
    isUnbounded: result.isUnbounded,
    liquidAssets: result.liquidAssets,
  };
}

export async function getTrialBalanceCached(): Promise<{
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
}> {
  const cached = await cacheGet<{
    totalDebits: number;
    totalCredits: number;
    isBalanced: boolean;
    revision?: number;
  }>(Keys.analytics(ANALYTICS_KEYS.TRIAL_BALANCE));

  const revision = await getFinancialRevision();
  if (cached && cached.revision === revision) {
    return cached;
  }

  const result = await precomputeTrialBalance();
  return {
    totalDebits: result.totalDebits,
    totalCredits: result.totalCredits,
    isBalanced: result.isBalanced,
  };
}
