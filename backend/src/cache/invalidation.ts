import { cacheDelete, cacheDeletePattern, cacheGet, cacheSet } from "./redis";
import { Keys, CACHE_TTL, ANALYTICS_KEYS } from "./keys";
import {
  precomputeAccountBalance,
  precomputeNetWorth,
  precomputeBurnRate,
  precomputeRunway,
  precomputeTrialBalance,
  precomputePeriodSummary,
} from "./precompute";

// Invalidate a single account balance and trigger recomputation
export async function invalidateAccountBalance(accountId: number): Promise<void> {
  await cacheDelete(Keys.accountBalance(accountId));
}

// Invalidate all account balances
export async function invalidateAllAccountBalances(): Promise<void> {
  await cacheDeletePattern(Keys.allAccountBalances());
}

// Invalidate period summary
export async function invalidatePeriodSummary(periodId: number): Promise<void> {
  await cacheDelete(Keys.periodSummary(periodId));
}

// Invalidate all period summaries
export async function invalidateAllPeriodSummaries(): Promise<void> {
  await cacheDeletePattern(Keys.allPeriodSummaries());
}

// Invalidate all analytics
export async function invalidateAllAnalytics(): Promise<void> {
  await cacheDeletePattern(Keys.allAnalytics());
}

// Invalidate everything (nuclear option)
export async function invalidateEverything(): Promise<void> {
  await Promise.all([
    invalidateAllAccountBalances(),
    invalidateAllPeriodSummaries(),
    invalidateAllAnalytics(),
  ]);
}

// Invalidate and recompute a single account balance (synchronous recomputation)
export async function invalidateAndRecomputeAccountBalance(accountId: number): Promise<void> {
  await invalidateAccountBalance(accountId);
  await precomputeAccountBalance(accountId);
}

// Invalidate and recompute all analytics (used after transaction mutations)
export async function invalidateAndRecomputeAnalytics(): Promise<void> {
  await invalidateAllAnalytics();
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
}

// Main invalidation pipeline - call this after any transaction mutation
export async function invalidateOnTransactionMutation(
  context: TransactionMutationContext,
): Promise<void> {
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
  if (cached) {
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
  }>(Keys.analytics(ANALYTICS_KEYS.NET_WORTH));

  if (cached) {
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
  }>(Keys.analytics(ANALYTICS_KEYS.BURN_RATE));

  if (cached) {
    return cached;
  }

  const result = await precomputeBurnRate();
  return {
    grossBurnRate: result.grossBurnRate,
    period: result.period,
  };
}

export async function getRunwayCached(): Promise<{
  runwayMonths: number;
  liquidAssets: number;
}> {
  const cached = await cacheGet<{
    runwayMonths: number;
    liquidAssets: number;
  }>(Keys.analytics(ANALYTICS_KEYS.RUNWAY));

  if (cached) {
    return cached;
  }

  const result = await precomputeRunway();
  return {
    runwayMonths: result.runwayMonths,
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
  }>(Keys.analytics(ANALYTICS_KEYS.TRIAL_BALANCE));

  if (cached) {
    return cached;
  }

  const result = await precomputeTrialBalance();
  return {
    totalDebits: result.totalDebits,
    totalCredits: result.totalCredits,
    isBalanced: result.isBalanced,
  };
}
