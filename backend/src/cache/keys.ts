// Cache key constants and helpers for the Fainens Redis caching layer

export const CACHE_TTL = {
  // Short-lived: balances can change frequently
  ACCOUNT_BALANCE: 300, // 5 minutes

  // Medium-lived: period summaries
  PERIOD_SUMMARY: 600, // 10 minutes

  // Long-lived: analytics aggregates (invalidated on mutations)
  ANALYTICS: 86400, // 24 hours

  // Default fallback
  DEFAULT: 3600, // 1 hour
} as const;

// Key prefixes for organization
export const PREFIXES = {
  ACCOUNT: "account",
  PERIOD: "period",
  ANALYTICS: "analytics",
} as const;

// Analytics sub-keys
export const ANALYTICS_KEYS = {
  NET_WORTH: "net_worth",
  BURN_RATE: "burn_rate",
  RUNWAY: "runway",
  LIFESTYLE_CREEP: "lifestyle_creep",
  TRIAL_BALANCE: "trial_balance",
  OPPORTUNITY_COST: "opportunity_cost",
} as const;

// Helper to build cache keys
export function buildKey(prefix: string, ...parts: (string | number)[]): string {
  return [prefix, ...parts].join(":");
}

// Cache key builders
export const Keys = {
  // Account balance
  accountBalance: (accountId: number) => buildKey(PREFIXES.ACCOUNT, "balance", accountId),

  // All account balances pattern
  allAccountBalances: () => buildKey(PREFIXES.ACCOUNT, "balance", "*"),

  // Period summary
  periodSummary: (periodId: number) => buildKey(PREFIXES.PERIOD, "summary", periodId),

  // All period summaries pattern
  allPeriodSummaries: () => buildKey(PREFIXES.PERIOD, "summary", "*"),

  // Analytics
  analytics: (key: string) => buildKey(PREFIXES.ANALYTICS, key),

  // All analytics pattern
  allAnalytics: () => buildKey(PREFIXES.ANALYTICS, "*"),
} as const;
