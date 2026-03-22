import Redis from "ioredis";

// Redis client singleton
let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    redisClient = new Redis(redisUrl, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      /** Fail fast when disconnected so callers can fall back instead of hanging */
      enableOfflineQueue: false,
    });

    redisClient.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("Redis error:", err);
    });

    redisClient.on("connect", () => {
      // eslint-disable-next-line no-console
      console.log("Redis connected");
    });
  }
  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

// Cache key helpers
export const CacheKeys = {
  // Account balances
  accountBalance: (accountId: number) => `account:balance:${accountId}`,

  // Period summaries
  periodSummary: (periodId: number) => `period:summary:${periodId}`,

  // Analytics
  netWorth: () => "analytics:net_worth",
  burnRate: () => "analytics:burn_rate",
  runway: () => "analytics:runway",
  lifestyleCreep: () => "analytics:lifestyle_creep",
  trialBalance: () => "analytics:trial_balance",
  opportunityCost: () => "analytics:opportunity_cost",

  // Wildcard patterns for invalidation
  allAccountBalances: () => "account:balance:*",
  allPeriodSummaries: () => "period:summary:*",
  allAnalytics: () => "analytics:*",
} as const;

function logRedisOnce(message: string, err: unknown) {
  // eslint-disable-next-line no-console
  console.warn(`[cache] ${message}`, err instanceof Error ? err.message : err);
}

// Generic cache operations — never throw: Redis down should not 500 the API
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedisClient();
    const value = await redis.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  } catch (err) {
    logRedisOnce(`GET ${key} failed (using DB fallback)`, err);
    return null;
  }
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = 3600,
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    logRedisOnce(`SET ${key} skipped`, err);
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(key);
  } catch (err) {
    logRedisOnce(`DEL ${key} skipped`, err);
  }
}

export async function cacheDeletePattern(pattern: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (err) {
    logRedisOnce(`DEL pattern ${pattern} skipped`, err);
  }
}

export async function cacheFlushAll(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.flushall();
  } catch (err) {
    logRedisOnce("FLUSHALL skipped", err);
  }
}
