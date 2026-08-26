import { eq, inArray } from "drizzle-orm";

import { db } from "../db/client";
import { cacheInvalidationOutbox } from "../db/schema";
import { getFinancialRevision } from "./financial-revision";
import { cacheDelete, cacheDeletePattern } from "../cache/redis";
import { Keys } from "../cache/keys";

export type CacheInvalidationOperation = "account" | "period" | "analytics" | "insights" | "all";

/** Queue work after a committed mutation. Reads remain revision-guarded even
 * if the process crashes before this row is written. */
export async function enqueueCacheInvalidation(operation: CacheInvalidationOperation, options: { accountId?: number; periodId?: number; revision?: number } = {}): Promise<void> {
  try {
    const revision = options.revision ?? await getFinancialRevision();
    db.insert(cacheInvalidationOutbox).values({
      operation,
      accountId: options.accountId ?? null,
      periodId: options.periodId ?? null,
      revision,
      status: "pending",
      attempts: 0,
      createdAt: new Date(),
    }).run();
  } catch (err) {
    // A cache queue failure must never roll back or hide the user's committed
    // financial write. Revision guards force a DB recompute on the next read.
    // Keep the warning actionable for operators without spamming a stack trace.
    // eslint-disable-next-line no-console
    console.warn("[cache] unable to enqueue invalidation", operation, err instanceof Error ? err.message : err);
  }
}

async function runOperation(row: typeof cacheInvalidationOutbox.$inferSelect): Promise<boolean> {
  switch (row.operation) {
    case "account": return row.accountId == null ? false : await cacheDelete(Keys.accountBalance(row.accountId));
    case "period": return row.periodId == null ? false : await cacheDelete(Keys.periodSummary(row.periodId));
    case "analytics": return cacheDeletePattern(Keys.allAnalytics());
    case "insights": return cacheDeletePattern("insights:*");
    case "all":
      return (await Promise.all([
        cacheDeletePattern(Keys.allAccountBalances()),
        cacheDeletePattern(Keys.allPeriodSummaries()),
        cacheDeletePattern(Keys.allAnalytics()),
        cacheDeletePattern("insights:*"),
      ])).every(Boolean);
    default: return false;
  }
}

/** Best-effort worker; failed rows remain durable and are retried later. */
export async function processCacheInvalidationOutbox(limit = 100): Promise<{ processed: number; failed: number }> {
  const now = new Date();
  const rows = await db.select().from(cacheInvalidationOutbox)
    .where(inArray(cacheInvalidationOutbox.status, ["pending", "failed"]))
    .orderBy(cacheInvalidationOutbox.id)
    .limit(Math.min(Math.max(1, limit), 500));
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    const ok = await runOperation(row);
    if (ok) {
      db.update(cacheInvalidationOutbox).set({ status: "processed", processedAt: now, lastError: null }).where(eq(cacheInvalidationOutbox.id, row.id)).run();
      processed += 1;
    } else {
      db.update(cacheInvalidationOutbox).set({ status: "failed", attempts: row.attempts + 1, lastError: "Redis unavailable or invalid invalidation target" }).where(eq(cacheInvalidationOutbox.id, row.id)).run();
      failed += 1;
    }
  }
  return { processed, failed };
}
