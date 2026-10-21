import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { closeSync, openSync, promises as fs, readFileSync, readSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { db, dbPath } from "../db/client";
import { bootstrapDb } from "../db/migrate";
import { databaseBackupSettings } from "../db/schema";
import { env } from "../lib/env";
import { downloadFile, isObjectStorageConfigured, listFiles, uploadFile } from "./r2";

const backendRoot = resolve(__dirname, "..", "..");

const BACKUP_CONTENT_TYPE = "application/vnd.sqlite3";
const BACKUP_PREFIX = "database-backups/";

export const BACKUP_FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly"] as const;
export type BackupFrequency = typeof BACKUP_FREQUENCIES[number];

const frequencyMonths: Record<BackupFrequency, number> = {
  weekly: 0,
  biweekly: 0,
  monthly: 1,
  quarterly: 3,
};

export type DatabaseBackupResult = {
  key: string;
  size: number;
  createdAt: string;
};

export type DatabaseBackupEntry = {
  key: string;
  size: number;
  createdAt: number;
};

export type DatabaseBackupSettingsView = {
  enabled: boolean;
  frequency: BackupFrequency;
  lastBackupAt: number | null;
  nextBackupAt: number | null;
  backups: DatabaseBackupEntry[];
  pagination: { page: number; pageSize: number; total: number; hasNext: boolean };
};

export function isBackupFrequency(value: unknown): value is BackupFrequency {
  return typeof value === "string" && (BACKUP_FREQUENCIES as readonly string[]).includes(value);
}

/** `label` marks a backup taken for a reason, such as the one taken just before a restore. */
export function databaseBackupKey(date = new Date(), label?: string): string {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  return `${BACKUP_PREFIX}fainens-${timestamp}${label ? `-${label}` : ""}.db`;
}

/** Only keys this feature wrote: a file directly under the backup prefix, ending in .db. */
export function isDatabaseBackupKey(key: string): boolean {
  return /^database-backups\/[A-Za-z0-9._-]+\.db$/.test(key) && !key.includes("..");
}

function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function nextDatabaseBackupAt(lastBackupAt: number | Date | null, frequency: BackupFrequency): number | null {
  if (lastBackupAt == null) return null;
  const last = lastBackupAt instanceof Date ? lastBackupAt : new Date(lastBackupAt);
  if (frequencyMonths[frequency] > 0) return addCalendarMonths(last, frequencyMonths[frequency]).getTime();
  const days = frequency === "biweekly" ? 14 : 7;
  return last.getTime() + days * 24 * 60 * 60 * 1000;
}

async function createConsistentSnapshot(destination: string): Promise<void> {
  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destination);
  } finally {
    source.close();
  }
}

function verifySnapshot(snapshotPath: string): number {
  const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    const result = snapshot.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
    if (result.integrity_check !== "ok") {
      throw new Error(`Database backup integrity check failed: ${result.integrity_check ?? "unknown result"}`);
    }
    return Number(snapshot.prepare("PRAGMA page_count").get()?.page_count ?? 0)
      * Number(snapshot.prepare("PRAGMA page_size").get()?.page_size ?? 0);
  } finally {
    snapshot.close();
  }
}

/** Create and upload a consistent SQLite snapshot to the configured R2 bucket. */
export async function createDatabaseBackup(now = new Date(), label?: string): Promise<DatabaseBackupResult> {
  if (!isObjectStorageConfigured()) {
    throw new Error("Database backup requires the existing R2 storage configuration");
  }

  const temporaryDirectory = await fs.mkdtemp(join(tmpdir(), "fainens-database-backup-"));
  const snapshotPath = join(temporaryDirectory, "fainens.db");
  try {
    await createConsistentSnapshot(snapshotPath);
    const verifiedSize = verifySnapshot(snapshotPath);
    if (verifiedSize <= 0) throw new Error("Database backup is empty");
    const snapshot = await fs.readFile(snapshotPath);
    const uploaded = await uploadFile(databaseBackupKey(now, label), snapshot, BACKUP_CONTENT_TYPE);
    return { key: uploaded.key, size: uploaded.size, createdAt: now.toISOString() };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function listDatabaseBackups(page = 1, pageSize = 10): Promise<{ backups: DatabaseBackupEntry[]; latestCreatedAt: number | null; total: number; page: number; pageSize: number }> {
  const objects = await listFiles(BACKUP_PREFIX);
  const allBackups = objects
    .filter((object) => object.key.endsWith(".db"))
    .map((object) => ({ key: object.key, size: object.size, createdAt: object.lastModified?.getTime() ?? 0 }))
    .sort((a, b) => b.createdAt - a.createdAt || b.key.localeCompare(a.key));
  const safePageSize = Math.min(50, Math.max(1, Math.floor(pageSize) || 10));
  const total = allBackups.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(totalPages, Math.max(1, Math.floor(page) || 1));
  const start = (safePage - 1) * safePageSize;
  return {
    backups: allBackups.slice(start, start + safePageSize),
    latestCreatedAt: allBackups[0]?.createdAt || null,
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}

function normalizedOwnerEmail(ownerEmail: string): string {
  return ownerEmail.trim().toLowerCase();
}

async function settingsRow(ownerEmail: string) {
  return (await db.select().from(databaseBackupSettings)
    .where(eq(databaseBackupSettings.ownerEmail, normalizedOwnerEmail(ownerEmail))).limit(1))[0];
}

/**
 * The newer of the owner's recorded backup and the newest snapshot in storage. Storage is shared,
 * so a snapshot taken by another account or a script still counts as the latest backup.
 */
export function latestBackupTime(recorded: number | null, newestInStorage: number | null): number | null {
  if (recorded == null) return newestInStorage;
  if (newestInStorage == null) return recorded;
  return Math.max(recorded, newestInStorage);
}

export async function getDatabaseBackupSettings(ownerEmail: string, page = 1, pageSize = 10): Promise<DatabaseBackupSettingsView> {
  const [row, backupPage] = await Promise.all([settingsRow(ownerEmail), listDatabaseBackups(page, pageSize)]);
  const frequency = isBackupFrequency(row?.frequency) ? row.frequency : "weekly";
  const lastBackupAt = latestBackupTime(row?.lastBackupAt?.getTime() ?? null, backupPage.latestCreatedAt);
  return {
    enabled: row?.enabled ?? env.DATABASE_BACKUP_ENABLED,
    frequency,
    lastBackupAt,
    nextBackupAt: nextDatabaseBackupAt(lastBackupAt, frequency),
    backups: backupPage.backups,
    pagination: { page: backupPage.page, pageSize: backupPage.pageSize, total: backupPage.total, hasNext: backupPage.page * backupPage.pageSize < backupPage.total },
  };
}

export async function updateDatabaseBackupSettings(ownerEmail: string, input: { enabled?: boolean; frequency?: BackupFrequency }): Promise<DatabaseBackupSettingsView> {
  const owner = normalizedOwnerEmail(ownerEmail);
  const existing = await settingsRow(owner);
  const frequency = input.frequency ?? (isBackupFrequency(existing?.frequency) ? existing.frequency : "weekly");
  const enabled = input.enabled ?? existing?.enabled ?? env.DATABASE_BACKUP_ENABLED;
  if (existing) {
    await db.update(databaseBackupSettings).set({ enabled, frequency, updatedAt: new Date() }).where(eq(databaseBackupSettings.ownerEmail, owner));
  } else {
    await db.insert(databaseBackupSettings).values({ ownerEmail: owner, enabled, frequency });
  }
  return getDatabaseBackupSettings(owner);
}

async function saveLastBackup(ownerEmail: string, createdAt: Date): Promise<void> {
  const owner = normalizedOwnerEmail(ownerEmail);
  const existing = await settingsRow(owner);
  if (existing) {
    await db.update(databaseBackupSettings).set({ lastBackupAt: createdAt, updatedAt: new Date() }).where(eq(databaseBackupSettings.ownerEmail, owner));
  } else {
    await db.insert(databaseBackupSettings).values({ ownerEmail: owner, enabled: env.DATABASE_BACKUP_ENABLED, frequency: "weekly", lastBackupAt: createdAt });
  }
}

let activeBackup: Promise<DatabaseBackupResult | null> | null = null;
let restoring = false;

async function runDatabaseBackup(ownerEmail: string, now: Date, force: boolean): Promise<DatabaseBackupResult | null> {
  if (restoring) throw new Error("A restore is running; try again when it's done");
  if (activeBackup) return activeBackup;
  activeBackup = (async () => {
    if (!env.DATABASE_BACKUP_ENABLED && !force) return null;
    const settings = await getDatabaseBackupSettings(ownerEmail);
    if (!force && !settings.enabled) return null;
    if (!force && settings.nextBackupAt != null && now.getTime() < settings.nextBackupAt) return null;
    const result = await createDatabaseBackup(now);
    await saveLastBackup(ownerEmail, now);
    return result;
  })().finally(() => { activeBackup = null; });
  return activeBackup;
}

export async function processDueDatabaseBackup(now = new Date()): Promise<DatabaseBackupResult | null> {
  return runDatabaseBackup(env.ALLOWED_EMAIL, now, false);
}

export async function runDatabaseBackupNow(ownerEmail: string, now = new Date()): Promise<DatabaseBackupResult> {
  const result = await runDatabaseBackup(ownerEmail, now, true);
  if (!result) throw new Error("Database backups are disabled by the server configuration");
  return result;
}

/** A backup saved in storage, read for downloading or restoring; only keys this feature wrote. */
export async function readDatabaseBackup(key: string): Promise<Buffer> {
  if (!isDatabaseBackupKey(key)) throw new RestoreError("That isn't one of your backups");
  return downloadFile(key);
}

/** A restore that can't go ahead, said in words for the person restoring. */
export class RestoreError extends Error {}

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");
const RESTORE_TABLES = ["transaction", "transaction_line", "account", "__drizzle_migrations"];

/** The newest migration this version of the app knows. */
function latestKnownMigration(): number {
  const journal = JSON.parse(readFileSync(join(backendRoot, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: Array<{ when: number }> };
  return Math.max(...journal.entries.map((entry) => entry.when));
}

/**
 * Checks a file before it's restored: it must be an intact SQLite database with Fainens' ledger in
 * it, and not from a newer version of the app than this one (which couldn't read it).
 */
export function checkBackupFile(path: string): void {
  const header = Buffer.alloc(SQLITE_HEADER.length);
  const handle = openSync(path, "r");
  try { readSync(handle, header, 0, header.length, 0); } finally { closeSync(handle); }
  if (!header.equals(SQLITE_HEADER)) throw new RestoreError("That file isn't a Fainens backup");
  let snapshot: InstanceType<typeof Database>;
  try {
    snapshot = new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    throw new RestoreError("That file isn't a Fainens backup");
  }
  try {
    const integrity = snapshot.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
    if (integrity.integrity_check !== "ok") throw new RestoreError("That backup is damaged and can't be restored");
    const tables = new Set((snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
    if (!RESTORE_TABLES.every((table) => tables.has(table))) throw new RestoreError("That file isn't a Fainens backup");
    const newest = Number((snapshot.prepare("SELECT MAX(created_at) AS newest FROM __drizzle_migrations").get() as { newest: number | null }).newest ?? 0);
    if (newest > latestKnownMigration()) throw new RestoreError("That backup is from a newer version of Fainens; update this one first");
  } finally {
    snapshot.close();
  }
}

export type RestoreResult = { restoredAt: string; undoBackupKey: string | null };

/**
 * Replaces all of the data with a backup file. In order: the file is checked; the data as it is now
 * is backed up to storage (when it's configured), so the restore can be undone from the list; a copy
 * is also kept beside the database; the backup is copied in with SQLite's online backup, then
 * brought up to this version's schema. If that fails, the copy goes back. The data's revision moves
 * past both, so nothing cached from before is served.
 */
export async function restoreDatabaseFromFile(filePath: string, now = new Date(), options: { undoBackup?: boolean } = {}): Promise<RestoreResult> {
  if (restoring || activeBackup) throw new RestoreError("A backup or restore is already running; try again in a moment");
  restoring = true;
  const workDirectory = await fs.mkdtemp(join(tmpdir(), "fainens-restore-"));
  try {
    checkBackupFile(filePath);
    const undo = options.undoBackup !== false && isObjectStorageConfigured() ? await createDatabaseBackup(now, "before-restore") : null;
    const revisionBefore = currentRevision();
    const rollbackPath = join(workDirectory, "before-restore.db");
    await db.$client.backup(rollbackPath);
    try {
      await copyDatabaseInto(filePath);
      await bootstrapDb();
    } catch (error) {
      await copyDatabaseInto(rollbackPath);
      await bootstrapDb();
      throw new RestoreError(`That backup couldn't be brought up to this version, so nothing was changed (${error instanceof Error ? error.message : "unknown error"})`);
    }
    db.$client.prepare("UPDATE financial_state SET revision = MAX(revision, ?) + 1, updated_at = ? WHERE id = 1").run(revisionBefore, now.getTime());
    return { restoredAt: now.toISOString(), undoBackupKey: undo?.key ?? null };
  } finally {
    restoring = false;
    await fs.rm(workDirectory, { recursive: true, force: true });
  }
}

/** Restores one of the backups in storage. */
export async function restoreDatabaseBackup(key: string, now = new Date()): Promise<RestoreResult> {
  const data = await readDatabaseBackup(key);
  return restoreDatabaseBuffer(data, now);
}

/** Restores a backup file sent from the browser. */
export async function restoreDatabaseBuffer(data: Buffer, now = new Date()): Promise<RestoreResult> {
  const directory = await fs.mkdtemp(join(tmpdir(), "fainens-restore-upload-"));
  try {
    const path = join(directory, "backup.db");
    await fs.writeFile(path, data);
    return await restoreDatabaseFromFile(path, now);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function currentRevision(): number {
  const row = db.$client.prepare("SELECT revision FROM financial_state WHERE id = 1").get() as { revision?: number } | undefined;
  return Number(row?.revision ?? 0);
}

/** Copies a database file over the live one with SQLite's online backup, so open connections stay valid. */
async function copyDatabaseInto(sourcePath: string): Promise<void> {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(dbPath);
  } finally {
    source.close();
  }
}
