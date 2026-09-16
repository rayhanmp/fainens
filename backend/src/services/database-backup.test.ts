import { describe, expect, it } from "vitest";

import { databaseBackupKey, nextDatabaseBackupAt } from "./database-backup";

describe("database backups", () => {
  it("uses a stable dedicated R2 prefix and timestamped SQLite filename", () => {
    expect(databaseBackupKey(new Date("2026-09-16T08:30:45.123Z")))
      .toBe("database-backups/fainens-2026-09-16T08-30-45-123Z.db");
  });

  it("calculates calendar-aware user-selected cadences", () => {
    const last = new Date("2026-01-31T03:00:00.000Z").getTime();
    expect(nextDatabaseBackupAt(last, "weekly")).toBe(new Date("2026-02-07T03:00:00.000Z").getTime());
    expect(nextDatabaseBackupAt(last, "biweekly")).toBe(new Date("2026-02-14T03:00:00.000Z").getTime());
    expect(nextDatabaseBackupAt(last, "monthly")).toBe(new Date("2026-02-28T03:00:00.000Z").getTime());
    expect(nextDatabaseBackupAt(last, "quarterly")).toBe(new Date("2026-04-30T03:00:00.000Z").getTime());
  });
});
