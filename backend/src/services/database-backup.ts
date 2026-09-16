import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { db, dbPath } from "../db/client";
import { databaseBackupSettings } from "../db/schema";
import { env } from "../lib/env";
import { isObjectStorageConfigured, listFiles, uploadFile } from "./r2";

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
};

export function isBackupFrequency(value: unknown): value is BackupFrequency {
  return typeof value === "string" && (BACKUP_FREQUENCIES as readonly string[]).includes(value);
}

export function databaseBackupKey(date = new Date()): string {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  return `${BACKUP_PREFIX}fainens-${timestamp}.db`;
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
export async function createDatabaseBackup(now = new Date()): Promise<DatabaseBackupResult> {
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
    const uploaded = await uploadFile(databaseBackupKey(now), snapshot, BACKUP_CONTENT_TYPE);
    return { key: uploaded.key, size: uploaded.size, createdAt: now.toISOString() };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function listDatabaseBackups(): Promise<DatabaseBackupEntry[]> {
  const objects = await listFiles(BACKUP_PREFIX);
  return objects
    .filter((object) => object.key.endsWith(".db"))
    .map((object) => ({ key: object.key, size: object.size, createdAt: object.lastModified?.getTime() ?? 0 }))
    .sort((a, b) => b.createdAt - a.createdAt || b.key.localeCompare(a.key));
}

function normalizedOwnerEmail(ownerEmail: string): string {
  return ownerEmail.trim().toLowerCase();
}

async function settingsRow(ownerEmail: string) {
  return (await db.select().from(databaseBackupSettings)
    .where(eq(databaseBackupSettings.ownerEmail, normalizedOwnerEmail(ownerEmail))).limit(1))[0];
}

export async function getDatabaseBackupSettings(ownerEmail: string): Promise<DatabaseBackupSettingsView> {
  const [row, backups] = await Promise.all([settingsRow(ownerEmail), listDatabaseBackups()]);
  const frequency = isBackupFrequency(row?.frequency) ? row.frequency : "weekly";
  const lastBackupAt = row?.lastBackupAt?.getTime() ?? backups[0]?.createdAt ?? null;
  return {
    enabled: row?.enabled ?? env.DATABASE_BACKUP_ENABLED,
    frequency,
    lastBackupAt,
    nextBackupAt: nextDatabaseBackupAt(lastBackupAt, frequency),
    backups,
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

async function runDatabaseBackup(ownerEmail: string, now: Date, force: boolean): Promise<DatabaseBackupResult | null> {
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
