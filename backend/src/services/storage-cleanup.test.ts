import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";

const state = vi.hoisted(() => ({ db: null as any, storageUp: false }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const value = state.db[key];
    return typeof value === "function" ? value.bind(state.db) : value;
  },
}) }));
vi.mock("./r2", () => ({
  deleteFile: vi.fn(async () => { if (!state.storageUp) throw new Error("storage unreachable"); }),
}));

import { getStorageCleanupStatus, processStorageDeletionOutbox, retryDelayMs, retryStuckStorageDeletions } from "./storage-cleanup";

const MINUTE = 60_000;

describe("storage deletion outbox", () => {
  let sqlite: InstanceType<typeof Database>;
  const row = (id = 1) => sqlite.prepare("SELECT status, attempts, next_attempt_at AS nextAttemptAt FROM storage_deletion_outbox WHERE id = ?").get(id) as { status: string; attempts: number; nextAttemptAt: number | null };
  const add = (attempts = 0, status = "pending") => sqlite.prepare("INSERT INTO storage_deletion_outbox (r2_key, entity_type, entity_id, status, attempts, last_error, created_at) VALUES ('attachments/a.jpg', 'attachment', 1, ?, ?, ?, 0)").run(status, attempts, status === "needs_attention" ? "storage unreachable" : null);

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE storage_deletion_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, r2_key TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      created_at INTEGER NOT NULL, processed_at INTEGER, next_attempt_at INTEGER)`);
    state.db = drizzle(sqlite, { schema });
    state.storageUp = false;
  });

  it("waits longer after each failure, up to a day", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([5 * MINUTE, 10 * MINUTE, 20 * MINUTE, 40 * MINUTE]);
    expect(retryDelayMs(20)).toBe(24 * 60 * MINUTE);
    // Twenty tries cover more than a week of outage.
    const total = Array.from({ length: 19 }, (_, index) => retryDelayMs(index + 1)).reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThan(7 * 24 * 60 * MINUTE);
  });

  it("skips a file until its wait is over", async () => {
    add();
    const start = new Date(1_000_000_000_000);
    expect(await processStorageDeletionOutbox(undefined, start)).toEqual({ processed: 0, failed: 1 });
    expect(row()).toEqual({ status: "pending", attempts: 1, nextAttemptAt: start.getTime() + 5 * MINUTE });

    expect(await processStorageDeletionOutbox(undefined, new Date(start.getTime() + 4 * MINUTE))).toEqual({ processed: 0, failed: 0 });
    state.storageUp = true;
    expect(await processStorageDeletionOutbox(undefined, new Date(start.getTime() + 5 * MINUTE))).toEqual({ processed: 1, failed: 0 });
    expect(row().status).toBe("completed");
  });

  it("counts files that ran out of tries, and tries them again on request", async () => {
    add(19);
    await processStorageDeletionOutbox();
    expect(row().status).toBe("needs_attention");
    expect(await getStorageCleanupStatus()).toEqual({ stuck: 1, lastError: "storage unreachable" });

    // Still unreachable: back to retrying on the schedule, with a fresh set of tries.
    expect(await retryStuckStorageDeletions()).toMatchObject({ processed: 0, failed: 1, stuck: 0 });
    expect(row()).toMatchObject({ status: "pending", attempts: 1 });

    sqlite.prepare("UPDATE storage_deletion_outbox SET status = 'needs_attention' WHERE id = 1").run();
    state.storageUp = true;
    expect(await retryStuckStorageDeletions()).toEqual({ processed: 1, failed: 0, stuck: 0, lastError: null });
    expect(row().status).toBe("completed");
  });
});
