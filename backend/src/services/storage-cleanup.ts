import { and, count, desc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";

import { db } from "../db/client";
import { storageDeletionOutbox } from "../db/schema";
import { deleteFile } from "./r2";

const MAX_ATTEMPTS = 20;
const FIRST_RETRY_MS = 5 * 60_000;
const LONGEST_RETRY_MS = 24 * 60 * 60_000;

/**
 * How long to wait after a failed try: 5 minutes, doubling up to a day. Twenty tries then span about
 * two weeks, so a storage outage of a day or two doesn't use them all up.
 */
export function retryDelayMs(attempts: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1), LONGEST_RETRY_MS);
}

export async function processStorageDeletionOutbox(outboxIds?: number[], now = new Date()): Promise<{
  processed: number;
  failed: number;
}> {
  const pending = await db
    .select({
      id: storageDeletionOutbox.id,
      r2Key: storageDeletionOutbox.r2Key,
      attempts: storageDeletionOutbox.attempts,
    })
    .from(storageDeletionOutbox)
    .where(
      outboxIds?.length
        ? and(
            inArray(storageDeletionOutbox.id, outboxIds),
            eq(storageDeletionOutbox.status, "pending"),
          )
        : and(
            eq(storageDeletionOutbox.status, "pending"),
            lt(storageDeletionOutbox.attempts, MAX_ATTEMPTS),
            or(isNull(storageDeletionOutbox.nextAttemptAt), lte(storageDeletionOutbox.nextAttemptAt, now)),
          ),
    )
    .limit(100);

  let processed = 0;
  let failed = 0;
  for (const item of pending) {
    try {
      // deleteFile is idempotent for both R2 and local storage.
      await deleteFile(item.r2Key);
      await db
        .update(storageDeletionOutbox)
        .set({
          status: "completed",
          attempts: item.attempts + 1,
          lastError: null,
          processedAt: new Date(),
          nextAttemptAt: null,
        })
        .where(eq(storageDeletionOutbox.id, item.id));
      processed += 1;
    } catch (error) {
      const attempts = item.attempts + 1;
      await db
        .update(storageDeletionOutbox)
        .set({
          status: attempts >= MAX_ATTEMPTS ? "needs_attention" : "pending",
          attempts,
          lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
        })
        .where(eq(storageDeletionOutbox.id, item.id));
      failed += 1;
    }
  }

  return { processed, failed };
}

/** Files that were deleted in the app but are still in storage after every retry. */
export async function getStorageCleanupStatus(): Promise<{ stuck: number; lastError: string | null }> {
  const [row] = await db.select({ stuck: count() }).from(storageDeletionOutbox).where(eq(storageDeletionOutbox.status, "needs_attention"));
  const [latest] = await db.select({ lastError: storageDeletionOutbox.lastError }).from(storageDeletionOutbox)
    .where(eq(storageDeletionOutbox.status, "needs_attention"))
    .orderBy(desc(storageDeletionOutbox.id))
    .limit(1);
  return { stuck: row?.stuck ?? 0, lastError: latest?.lastError ?? null };
}

/** Gives the stuck files a fresh set of tries, starting now. */
export async function retryStuckStorageDeletions(): Promise<{ processed: number; failed: number; stuck: number; lastError: string | null }> {
  const stuck = await db.select({ id: storageDeletionOutbox.id }).from(storageDeletionOutbox).where(eq(storageDeletionOutbox.status, "needs_attention"));
  const ids = stuck.map((row) => row.id);
  if (ids.length) {
    await db.update(storageDeletionOutbox)
      .set({ status: "pending", attempts: 0, nextAttemptAt: null })
      .where(inArray(storageDeletionOutbox.id, ids));
  }
  // Only the first try happens now; any that fail again go back to retrying on the usual schedule.
  const result = ids.length ? await processStorageDeletionOutbox(ids) : { processed: 0, failed: 0 };
  return { ...result, ...(await getStorageCleanupStatus()) };
}
