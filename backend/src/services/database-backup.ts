import Database from "better-sqlite3";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { dbPath } from "../db/client";
import { env } from "../lib/env";
import { isObjectStorageConfigured, uploadFile } from "./r2";

const BACKUP_CONTENT_TYPE = "application/vnd.sqlite3";
const BACKUP_PREFIX = "database-backups";

export type DatabaseBackupResult = {
  key: string;
  size: number;
  createdAt: string;
};

export function databaseBackupKey(date = new Date()): string {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  return `${BACKUP_PREFIX}/fainens-${timestamp}.db`;
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
export async function createDatabaseBackup(now = new Date()): Promise<DatabaseBackupResult | null> {
  if (!env.DATABASE_BACKUP_ENABLED) return null;
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
    const key = databaseBackupKey(now);
    const uploaded = await uploadFile(key, snapshot, BACKUP_CONTENT_TYPE);
    return { key: uploaded.key, size: uploaded.size, createdAt: now.toISOString() };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}
