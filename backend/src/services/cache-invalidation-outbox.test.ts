import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";

const state = vi.hoisted(() => ({ db: null as any, redisUp: false }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const value = state.db[key];
    return typeof value === "function" ? value.bind(state.db) : value;
  },
}) }));
vi.mock("./financial-revision", () => ({ getFinancialRevision: async () => 3 }));
vi.mock("../cache/redis", () => ({
  cacheDelete: vi.fn(async () => state.redisUp),
  cacheDeletePattern: vi.fn(async () => state.redisUp),
}));

import { enqueueCacheInvalidation, processCacheInvalidationOutbox } from "./cache-invalidation-outbox";

describe("cache invalidation outbox", () => {
  let sqlite: InstanceType<typeof Database>;
  const rows = () => sqlite.prepare("SELECT operation, account_id AS accountId, status, attempts FROM cache_invalidation_outbox ORDER BY id").all();

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE cache_invalidation_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, account_id INTEGER, period_id INTEGER,
      revision INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, created_at INTEGER NOT NULL, processed_at INTEGER)`);
    state.db = drizzle(sqlite, { schema });
    state.redisUp = false;
  });

  it("keeps one waiting row per target while Redis is down", async () => {
    await enqueueCacheInvalidation("account", { accountId: 2 });
    await enqueueCacheInvalidation("account", { accountId: 2 });
    await enqueueCacheInvalidation("account", { accountId: 5 });
    await enqueueCacheInvalidation("analytics");
    await enqueueCacheInvalidation("analytics");

    expect(rows()).toEqual([
      { operation: "account", accountId: 2, status: "pending", attempts: 0 },
      { operation: "account", accountId: 5, status: "pending", attempts: 0 },
      { operation: "analytics", accountId: null, status: "pending", attempts: 0 },
    ]);
  });

  it("retries until Redis is back, then clears the rows", async () => {
    await enqueueCacheInvalidation("periods");
    expect(await processCacheInvalidationOutbox()).toEqual({ processed: 0, failed: 1 });
    expect(rows()).toEqual([{ operation: "periods", accountId: null, status: "failed", attempts: 1 }]);

    // A failed row still counts as waiting, so the same target isn't added again.
    await enqueueCacheInvalidation("periods");
    expect(rows()).toHaveLength(1);

    state.redisUp = true;
    expect(await processCacheInvalidationOutbox()).toEqual({ processed: 1, failed: 0 });
    expect(rows()).toEqual([{ operation: "periods", accountId: null, status: "processed", attempts: 1 }]);

    // Once processed, a later failure starts a new row.
    await enqueueCacheInvalidation("periods");
    expect(rows()).toHaveLength(2);
  });
});
