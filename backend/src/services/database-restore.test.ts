import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const migrationsFolder = resolve(__dirname, "..", "..", "drizzle");

// Restoring replaces the whole database, so these tests run against a throwaway file: the path is
// set before anything opens the database, and storage is replaced so nothing can be uploaded.
const directory = mkdtempSync(join(tmpdir(), "fainens-restore-test-"));
process.env.FAINENS_DB_PATH = join(directory, "live.db");
vi.mock("./r2", () => ({
  isObjectStorageConfigured: () => false,
  uploadFile: async () => { throw new Error("storage is not used in tests"); },
  downloadFile: async () => { throw new Error("storage is not used in tests"); },
  listFiles: async () => [],
}));

type Modules = {
  client: typeof import("../db/client");
  migrate: typeof import("../db/migrate");
  backup: typeof import("./database-backup");
};
let m: Modules;

const live = () => m.client.db.$client;
const name = () => (live().prepare("SELECT preferred_name AS name FROM user_profile WHERE owner_email = 'me@test'").get() as { name: string } | undefined)?.name;
const setName = (value: string) => live().prepare("INSERT INTO user_profile (owner_email, preferred_name) VALUES ('me@test', ?) ON CONFLICT(owner_email) DO UPDATE SET preferred_name = excluded.preferred_name").run(value);
const revision = () => Number((live().prepare("SELECT revision FROM financial_state WHERE id = 1").get() as { revision: number }).revision);

/** A backup of the live database as it is now. */
async function snapshot(file: string, change?: (copy: InstanceType<typeof Database>) => void) {
  const path = join(directory, file);
  await live().backup(path);
  if (change) {
    const copy = new Database(path);
    change(copy);
    copy.close();
  }
  return path;
}

beforeAll(async () => {
  m = {
    client: await import("../db/client"),
    migrate: await import("../db/migrate"),
    backup: await import("./database-backup"),
  };
  expect(m.client.dbPath).toBe(join(directory, "live.db"));
  await m.migrate.bootstrapDb();
});

afterAll(() => {
  live().close();
  rmSync(directory, { recursive: true, force: true });
});

describe("restoring a backup", () => {
  it("replaces the data with the backup's and moves the revision past both", async () => {
    setName("In the backup");
    const file = await snapshot("backup.db");
    setName("Changed since");
    live().prepare("UPDATE financial_state SET revision = 41 WHERE id = 1").run();

    const result = await m.backup.restoreDatabaseFromFile(file, new Date("2026-10-21T10:00:00Z"));

    expect(name()).toBe("In the backup");
    expect(revision()).toBe(42);
    expect(result.undoBackupKey).toBeNull();
  });

  it("brings an older backup up to this version", async () => {
    // A backup from before goal plans had colours: the real migrations, run only up to 0058.
    const folder = join(directory, "older-migrations");
    mkdirSync(join(folder, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const older = journal.entries.filter((entry) => entry.idx <= 58);
    for (const entry of older) copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: older }));
    const file = join(directory, "older.db");
    const sqlite = new Database(file);
    migrate(drizzle(sqlite), { migrationsFolder: folder });
    sqlite.close();

    await m.backup.restoreDatabaseFromFile(file);
    const columns = (live().prepare("PRAGMA table_info('goal_plan')").all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns).toContain("color");
  });

  it("refuses files that aren't intact Fainens backups, leaving the data alone", async () => {
    setName("Keep me");
    const text = join(directory, "notes.txt");
    writeFileSync(text, "not a database at all");
    await expect(m.backup.restoreDatabaseFromFile(text)).rejects.toThrow("isn't a Fainens backup");

    const other = join(directory, "other.db");
    const otherDb = new Database(other);
    otherDb.exec("CREATE TABLE recipe (id integer PRIMARY KEY)");
    otherDb.close();
    await expect(m.backup.restoreDatabaseFromFile(other)).rejects.toThrow("isn't a Fainens backup");

    const newer = await snapshot("newer.db", (copy) => copy.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 9999999999999)").run());
    await expect(m.backup.restoreDatabaseFromFile(newer)).rejects.toThrow("newer version");

    expect(name()).toBe("Keep me");
  });

  it("only reads backups this feature wrote", async () => {
    expect(m.backup.isDatabaseBackupKey("database-backups/fainens-2026-10-19T14-31-16-443Z.db")).toBe(true);
    expect(m.backup.isDatabaseBackupKey("database-backups/fainens-2026-10-21T10-00-00-000Z-before-restore.db")).toBe(true);
    expect(m.backup.isDatabaseBackupKey("database-backups/../goals/secret.db")).toBe(false);
    expect(m.backup.isDatabaseBackupKey("attachments/photo.db")).toBe(false);
    expect(m.backup.isDatabaseBackupKey("database-backups/nested/file.db")).toBe(false);
    await expect(m.backup.readDatabaseBackup("attachments/photo.db")).rejects.toThrow("isn't one of your backups");
  });
});
