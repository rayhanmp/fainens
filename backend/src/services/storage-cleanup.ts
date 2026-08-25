import { and, eq, inArray, lt } from "drizzle-orm";

import { db } from "../db/client";
import { storageDeletionOutbox } from "../db/schema";
import { deleteFile } from "./r2";

const MAX_ATTEMPTS = 20;

export async function processStorageDeletionOutbox(outboxIds?: number[]): Promise<{
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
        })
        .where(eq(storageDeletionOutbox.id, item.id));
      failed += 1;
    }
  }

  return { processed, failed };
}
