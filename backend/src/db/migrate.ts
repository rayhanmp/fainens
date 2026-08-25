import fs from "fs";
import path from "path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { db } from "./client";
import { seedDb } from "./seed";

const backendRoot = path.resolve(__dirname, "..", "..");

type MigrationJournal = { entries: Array<{ tag: string; when: number }> };

function tableExists(name: string): boolean {
  return Boolean(db.$client.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(name));
}

function columnExists(table: string, column: string): boolean {
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, "");
  const rows = db.$client.prepare(`PRAGMA table_info('${safeTable}')`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

/**
 * Databases created before checked-in migrations were enabled have all of the
 * user's data but no __drizzle_migrations history. Upgrade those databases in
 * place, then baseline them at the current journal version. A truly blank DB
 * still follows the normal migration path below.
 */
function baselineLegacyPushDatabase(journal: MigrationJournal): void {
  if (!tableExists("transaction")) return;
  if (tableExists("__drizzle_migrations")) {
    const row = db.$client.prepare("SELECT 1 FROM __drizzle_migrations LIMIT 1").get();
    if (row) return;
  }

  const legacyBaseline = journal.entries.find((entry) => entry.tag === "0003_slow_big_bertha");
  if (!legacyBaseline) throw new Error("Legacy compatibility baseline migration is missing");
  const upgrade = db.$client.transaction(() => {
    db.$client.exec(`
      CREATE TABLE IF NOT EXISTS pending_transaction (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        raw_message text NOT NULL,
        parsed_data text NOT NULL,
        status text DEFAULT 'pending' NOT NULL,
        parse_attempts integer DEFAULT 0 NOT NULL,
        last_error text,
        user_message_id text,
        source text DEFAULT 'whatsapp' NOT NULL,
        created_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
        updated_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL
      );
      CREATE TABLE IF NOT EXISTS splitbill_session (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        merchant_name text,
        receipt_date integer,
        receipt_image_r2_key text,
        parsed_items_json text,
        subtotal_cents integer,
        tax_cents integer,
        service_fee_cents integer,
        discount_cents integer,
        total_cents integer NOT NULL,
        people_json text,
        assignments_json text,
        split_result_json text,
        loan_ids text,
        status text DEFAULT 'pending' NOT NULL,
        created_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
        updated_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_splitbill_status ON splitbill_session(status);
      CREATE INDEX IF NOT EXISTS idx_splitbill_created_at ON splitbill_session(created_at);
      CREATE TABLE IF NOT EXISTS storage_deletion_outbox (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        r2_key text NOT NULL,
        entity_type text NOT NULL,
        entity_id integer NOT NULL,
        status text DEFAULT 'pending' NOT NULL,
        attempts integer DEFAULT 0 NOT NULL,
        last_error text,
        created_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
        processed_at integer
      );
      CREATE INDEX IF NOT EXISTS idx_storage_deletion_outbox_status
        ON storage_deletion_outbox(status);
    `);
    if (!columnExists("contact", "full_name")) {
      db.$client.exec("ALTER TABLE contact ADD COLUMN full_name text");
    }
    if (!columnExists("contact", "relationship_type")) {
      db.$client.exec("ALTER TABLE contact ADD COLUMN relationship_type text");
    }
    if (!columnExists("transaction", "subscription_id")) {
      db.$client.exec(
        "ALTER TABLE \"transaction\" ADD COLUMN subscription_id integer REFERENCES subscription(id)",
      );
    }
    db.$client.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )
    `);
    db.$client
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("legacy-push-baseline", legacyBaseline.when);
  });
  upgrade();
}

function assertRequiredSchema(): void {
  const requirements: Record<string, string[]> = {
    transaction: ["id", "date", "tx_type", "subscription_id"],
    transaction_line: ["transaction_id", "account_id", "debit", "credit"],
    storage_deletion_outbox: ["r2_key", "status", "attempts"],
    pending_transaction: ["raw_message", "status"],
    splitbill_session: ["total_cents", "status"],
    reconciliation_session: ["as_of_date", "status"],
    reconciliation_item: ["session_id", "account_id", "difference", "status"],
  };
  const missing = Object.entries(requirements).flatMap(([table, columns]) => {
    if (!tableExists(table)) return [`table ${table}`];
    return columns.filter((column) => !columnExists(table, column)).map((column) => `${table}.${column}`);
  });
  if (missing.length > 0) {
    throw new Error(`Database schema is incomplete after migration: ${missing.join(", ")}`);
  }
}

export async function bootstrapDb() {
  const migrationsFolder = path.join(backendRoot, "drizzle");
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

  if (!fs.existsSync(journalPath)) {
    throw new Error(`Migration journal not found: ${journalPath}`);
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as MigrationJournal;
  if (journal.entries.length === 0) throw new Error("Migration journal is empty");
  baselineLegacyPushDatabase(journal);

  // The better-sqlite3 migrator is synchronous and records every applied
  // migration in __drizzle_migrations. Startup must fail closed if the schema
  // cannot be brought to the checked-in version.
  migrate(db, { migrationsFolder });
  assertRequiredSchema();
  await seedDb(db);
}

