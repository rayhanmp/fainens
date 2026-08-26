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

function foreignKeyExists(table: string, fromColumn: string, toTable: string): boolean {
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, "");
  const rows = db.$client.prepare(`PRAGMA foreign_key_list('${safeTable}')`).all() as Array<{ from: string; table: string }>;
  return rows.some((row) => row.from === fromColumn && row.table === toTable);
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
      CREATE TABLE IF NOT EXISTS paylater_settlement_allocation (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        settlement_tx_id integer NOT NULL REFERENCES "transaction"(id) ON DELETE CASCADE,
        installment_id integer NOT NULL REFERENCES paylater_installment(id) ON DELETE CASCADE,
        amount_cents integer NOT NULL,
        created_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
        UNIQUE(settlement_tx_id, installment_id)
      );
      CREATE INDEX IF NOT EXISTS idx_paylater_settlement_allocation_tx
        ON paylater_settlement_allocation(settlement_tx_id);
      CREATE INDEX IF NOT EXISTS idx_paylater_settlement_allocation_installment
        ON paylater_settlement_allocation(installment_id);
      CREATE TABLE IF NOT EXISTS financial_state (
        id integer PRIMARY KEY NOT NULL,
        revision integer DEFAULT 0 NOT NULL,
        updated_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL
      );
      INSERT OR IGNORE INTO financial_state (id, revision) VALUES (1, 0);
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
    if (!columnExists("transaction", "status")) {
      db.$client.exec("ALTER TABLE \"transaction\" ADD COLUMN status text DEFAULT 'posted' NOT NULL");
    }
    if (!columnExists("transaction", "reversal_of_tx_id")) {
      db.$client.exec("ALTER TABLE \"transaction\" ADD COLUMN reversal_of_tx_id integer REFERENCES \"transaction\"(id)");
    }
    if (!columnExists("salary_period", "status")) {
      db.$client.exec("ALTER TABLE salary_period ADD COLUMN status text DEFAULT 'open' NOT NULL");
    }
    if (!columnExists("salary_period", "closed_at")) {
      db.$client.exec("ALTER TABLE salary_period ADD COLUMN closed_at integer");
    }
    if (!columnExists("salary_period", "reopened_at")) {
      db.$client.exec("ALTER TABLE salary_period ADD COLUMN reopened_at integer");
    }
    if (!columnExists("reconciliation_session", "lifecycle_status")) {
      db.$client.exec("ALTER TABLE reconciliation_session ADD COLUMN lifecycle_status text DEFAULT 'active' NOT NULL");
    }
    if (!columnExists("reconciliation_session", "voided_at")) {
      db.$client.exec("ALTER TABLE reconciliation_session ADD COLUMN voided_at integer");
    }
    if (!columnExists("reconciliation_session", "void_reason")) {
      db.$client.exec("ALTER TABLE reconciliation_session ADD COLUMN void_reason text");
    }
    if (!columnExists("loan_payment", "status")) {
      db.$client.exec("ALTER TABLE loan_payment ADD COLUMN status text DEFAULT 'posted' NOT NULL");
    }
    if (!columnExists("account", "liquidity_class")) {
      db.$client.exec("ALTER TABLE account ADD COLUMN liquidity_class text DEFAULT 'non_cash' NOT NULL");
      db.$client.exec("UPDATE account SET liquidity_class = 'cash_equivalent' WHERE type = 'asset'");
      db.$client.exec("UPDATE account SET liquidity_class = 'receivable' WHERE system_key = 'loans-receivable'");
    }
    if (!columnExists("loan_payment", "reversal_transaction_id")) {
      db.$client.exec("ALTER TABLE loan_payment ADD COLUMN reversal_transaction_id integer REFERENCES \"transaction\"(id)");
    }
    if (!columnExists("loan_payment", "reversed_at")) {
      db.$client.exec("ALTER TABLE loan_payment ADD COLUMN reversed_at integer");
    }
    if (!columnExists("loan_payment", "reversal_reason")) {
      db.$client.exec("ALTER TABLE loan_payment ADD COLUMN reversal_reason text");
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
    transaction: ["id", "date", "tx_type", "subscription_id", "status", "reversal_of_tx_id"],
    account: ["id", "type", "liquidity_class"],
    category: ["id", "name", "reporting_account_id"],
    transaction_line: ["transaction_id", "account_id", "debit", "credit"],
    transaction_category_allocation: ["transaction_id", "category_id", "amount"],
    storage_deletion_outbox: ["r2_key", "status", "attempts"],
    pending_transaction: ["raw_message", "status"],
    splitbill_session: ["total_cents", "status"],
    reconciliation_session: ["as_of_date", "status", "lifecycle_status", "voided_at", "void_reason"],
    reconciliation_item: ["session_id", "account_id", "difference", "status"],
    salary_period: ["id", "start_date", "end_date", "status", "closed_at", "reopened_at"],
    recurring_occurrence: ["job_type", "schedule_id", "occurrence_date", "status"],
    loan_payment: ["loan_id", "transaction_id", "status", "reversal_transaction_id", "reversed_at", "reversal_reason"],
    paylater_settlement_allocation: ["settlement_tx_id", "installment_id", "amount_cents"],
    financial_state: ["id", "revision", "updated_at"],
  };
  const missing = Object.entries(requirements).flatMap(([table, columns]) => {
    if (!tableExists(table)) return [`table ${table}`];
    return columns.filter((column) => !columnExists(table, column)).map((column) => `${table}.${column}`);
  });
  if (missing.length > 0) {
    throw new Error(`Database schema is incomplete after migration: ${missing.join(", ")}`);
  }
  if (!foreignKeyExists("transaction", "period_id", "salary_period")) {
    throw new Error("Database schema is incomplete after migration: transaction.period_id foreign key");
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

