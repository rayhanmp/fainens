// Redis caching layer exports

export {
  getRedisClient,
  closeRedisConnection,
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheDeletePattern,
  cacheFlushAll,
  CacheKeys,
} from "./redis";

export {
  CACHE_TTL,
  PREFIXES,
  ANALYTICS_KEYS,
  Keys,
  buildKey,
} from "./keys";

export {
  precomputeAccountBalance,
  precomputeAllAccountBalances,
  precomputePeriodSummary,
  precomputeNetWorth,
  precomputeBurnRate,
  precomputeRunway,
  precomputeTrialBalance,
  precomputeAllAnalytics,
  precomputeEverything,
  type AccountBalanceCache,
  type PeriodSummaryCache,
  type NetWorthCache,
  type BurnRateCache,
  type RunwayCache,
  type TrialBalanceCache,
} from "./precompute";

export {
  invalidateAccountBalance,
  invalidateAllAccountBalances,
  invalidatePeriodSummary,
  invalidateAllPeriodSummaries,
  invalidateAllAnalytics,
  invalidateEverything,
  invalidateAndRecomputeAccountBalance,
  invalidateAndRecomputeAnalytics,
  invalidateOnTransactionMutation,
  invalidateAndRecomputeOnTransactionMutation,
  type TransactionMutationContext,
  // Cache read helpers
  getAccountBalanceCached,
  getNetWorthCached,
  getBurnRateCached,
  getRunwayCached,
  getTrialBalanceCached,
} from "./invalidation";
