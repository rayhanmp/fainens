import { describe, expect, it } from "vitest";

import { databaseBackupKey } from "./database-backup";

describe("database backups", () => {
  it("uses a stable dedicated R2 prefix and timestamped SQLite filename", () => {
    expect(databaseBackupKey(new Date("2026-09-16T08:30:45.123Z")))
      .toBe("database-backups/fainens-2026-09-16T08-30-45-123Z.db");
  });
});
