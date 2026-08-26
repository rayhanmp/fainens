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

function applyTransactionPeriodForeignKeyMigration(): void {
  if (foreignKeyExists("transaction", "period_id", "salary_period")) return;
  if (db.$client.inTransaction) {
    throw new Error("Transaction period foreign-key repair must run outside a SQLite transaction");
  }
  // Reuse the checked-in 0013 migration rather than inventing a second table
  // shape. This table rebuild drops the parent table, so foreign keys must be
  // disabled *before* it begins. SQLite ignores PRAGMA foreign_keys changes
  // inside a transaction; if left enabled, DROP TABLE cascades into every
  // transaction_line, tag, and attachment row.
  const migrationPath = path.join(backendRoot, "drizzle", "0013_dapper_titania.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf8").replace(/--> statement-breakpoint/g, "");
  db.$client.pragma("foreign_keys = OFF");
  try {
    db.$client.exec(`
      DROP INDEX IF EXISTS idx_transactions_date;
      DROP INDEX IF EXISTS idx_transactions_period_id;
      DROP INDEX IF EXISTS idx_transactions_category_id;
      DROP INDEX IF EXISTS idx_transactions_tx_type;
    `);
    db.$client.exec(migrationSql);
  } finally {
    db.$client.pragma("foreign_keys = ON");
  }
  if (!foreignKeyExists("transaction", "period_id", "salary_period")) {
    throw new Error("Legacy transaction rebuild did not create the period foreign key");
  }
}

/**
 * Databases created before checked-in migrations were enabled have all of the
 * user's data but no __drizzle_migrations history. Upgrade those databases in
 * place, then baseline them at the current journal version. A truly blank DB
 * still follows the normal migration path below.
 */
function baselineLegacyPushDatabase(journal: MigrationJournal): void {
  if (!tableExists("transaction")) return;
  const compatibilityFloor = journal.entries.find((entry) => entry.tag === "0016_ancient_the_executioner");
  if (!compatibilityFloor) throw new Error("Legacy compatibility floor migration is missing");
  if (tableExists("__drizzle_migrations")) {
    const rows = db.$client.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at").all() as Array<{ hash: string; created_at: number }>;
    const isLegacyPush = rows.some((row) => row.hash.startsWith("legacy-push-baseline"));
    if (!isLegacyPush) return;
    if (rows.some((row) => Number(row.created_at) >= compatibilityFloor.when)) return;
  }

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
      CREATE TABLE IF NOT EXISTS reconciliation_session (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        as_of_date integer NOT NULL,
        status text NOT NULL,
        created_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reconciliation_item (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        session_id integer NOT NULL REFERENCES reconciliation_session(id) ON DELETE CASCADE,
        account_id integer NOT NULL REFERENCES account(id),
        ledger_balance integer NOT NULL,
        actual_balance integer NOT NULL,
        difference integer NOT NULL,
        status text NOT NULL,
        correction_transaction_id integer REFERENCES "transaction"(id) ON DELETE SET NULL,
        UNIQUE(session_id, account_id)
      );
      CREATE INDEX IF NOT EXISTS idx_reconciliation_item_account ON reconciliation_item(account_id);
      CREATE TABLE IF NOT EXISTS recurring_occurrence (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        job_type text NOT NULL,
        schedule_id integer NOT NULL,
        occurrence_date integer NOT NULL,
        status text NOT NULL,
        transaction_id integer REFERENCES "transaction"(id) ON DELETE SET NULL,
        last_error text,
        created_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
        updated_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
        UNIQUE(job_type, schedule_id, occurrence_date)
      );
      CREATE INDEX IF NOT EXISTS idx_recurring_occurrence_status ON recurring_occurrence(status);
      CREATE TABLE IF NOT EXISTS transaction_category_allocation (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        transaction_id integer NOT NULL REFERENCES "transaction"(id) ON DELETE CASCADE,
        category_id integer NOT NULL REFERENCES category(id),
        amount integer NOT NULL,
        UNIQUE(transaction_id, category_id)
      );
      CREATE INDEX IF NOT EXISTS idx_transaction_category_allocation_tx ON transaction_category_allocation(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_category_allocation_category ON transaction_category_allocation(category_id);
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
    if (tableExists("contact") && !columnExists("contact", "full_name")) {
      db.$client.exec("ALTER TABLE contact ADD COLUMN full_name text");
    }
    if (tableExists("contact") && !columnExists("contact", "relationship_type")) {
      db.$client.exec("ALTER TABLE contact ADD COLUMN relationship_type text");
    }
    if (tableExists("transaction") && !columnExists("transaction", "subscription_id")) {
      db.$client.exec(
        "ALTER TABLE \"transaction\" ADD COLUMN subscription_id integer REFERENCES subscription(id)",
      );
    }
    if (tableExists("transaction") && !columnExists("transaction", "status")) {
      db.$client.exec("ALTER TABLE \"transaction\" ADD COLUMN status text DEFAULT 'posted' NOT NULL");
    }
    if (tableExists("transaction") && !columnExists("transaction", "reversal_of_tx_id")) {
      db.$client.exec("ALTER TABLE \"transaction\" ADD COLUMN reversal_of_tx_id integer REFERENCES \"transaction\"(id)");
    }
    if (tableExists("salary_period") && !columnExists("salary_period", "status")) {
      db.$client.exec("ALTER TABLE salary_period ADD COLUMN status text DEFAULT 'open' NOT NULL");
    }
    if (tableExists("salary_period") && !columnExists("salary_period", "closed_at")) {
      db.$client.exec("ALTER TABLE salary_period ADD COLUMN closed_at integer");
    }
    if (tableExists("salary_period") && !columnExists("salary_period", "reopened_at")) {
      db.$client.exec("ALTER TABLE salary_period ADD COLUMN reopened_at integer");
    }
    if (tableExists("salary_period") && !columnExists("salary_period", "is_active")) {
      db.$client.exec("ALTER TABLE salary_period ADD COLUMN is_active integer DEFAULT 1 NOT NULL");
    }
    if (tableExists("salary_period") && !columnExists("salary_period", "archived_at")) {
      db.$client.exec("ALTER TABLE salary_period ADD COLUMN archived_at integer");
    }
    // Older pushed databases may predate reconciliation entirely. Do not
    // alter a table that migration 0004 is about to create.
    if (tableExists("reconciliation_session") && !columnExists("reconciliation_session", "lifecycle_status")) {
      db.$client.exec("ALTER TABLE reconciliation_session ADD COLUMN lifecycle_status text DEFAULT 'active' NOT NULL");
    }
    if (tableExists("reconciliation_session") && !columnExists("reconciliation_session", "voided_at")) {
      db.$client.exec("ALTER TABLE reconciliation_session ADD COLUMN voided_at integer");
    }
    if (tableExists("reconciliation_session") && !columnExists("reconciliation_session", "void_reason")) {
      db.$client.exec("ALTER TABLE reconciliation_session ADD COLUMN void_reason text");
    }
    if (tableExists("loan_payment") && !columnExists("loan_payment", "status")) {
      db.$client.exec("ALTER TABLE loan_payment ADD COLUMN status text DEFAULT 'posted' NOT NULL");
    }
    if (tableExists("account") && !columnExists("account", "liquidity_class")) {
      db.$client.exec("ALTER TABLE account ADD COLUMN liquidity_class text DEFAULT 'non_cash' NOT NULL");
      db.$client.exec("UPDATE account SET liquidity_class = 'cash_equivalent' WHERE type = 'asset'");
      db.$client.exec("UPDATE account SET liquidity_class = 'receivable' WHERE system_key = 'loans-receivable'");
    }
    if (tableExists("category") && !columnExists("category", "reporting_account_id")) {
      db.$client.exec("ALTER TABLE category ADD COLUMN reporting_account_id integer REFERENCES account(id)");
    }
    if (tableExists("loan_payment") && !columnExists("loan_payment", "reversal_transaction_id")) {
      db.$client.exec("ALTER TABLE loan_payment ADD COLUMN reversal_transaction_id integer REFERENCES \"transaction\"(id)");
    }
    if (tableExists("loan_payment") && !columnExists("loan_payment", "reversed_at")) {
      db.$client.exec("ALTER TABLE loan_payment ADD COLUMN reversed_at integer");
    }
    if (tableExists("loan_payment") && !columnExists("loan_payment", "reversal_reason")) {
      db.$client.exec("ALTER TABLE loan_payment ADD COLUMN reversal_reason text");
    }
    if (tableExists("paylater_installment") && !columnExists("paylater_installment", "paid_cents")) {
      db.$client.exec("ALTER TABLE paylater_installment ADD COLUMN paid_cents integer DEFAULT 0 NOT NULL");
    }
  });
  upgrade();
  // PRAGMA foreign_keys cannot take effect within the transaction above. Run
  // the destructive table rebuild only after the core compatibility changes
  // have committed, and do not mark the schema baseline until it succeeds.
  if (tableExists("transaction") && tableExists("salary_period")) {
    applyTransactionPeriodForeignKeyMigration();
  }
  db.$client.transaction(() => {
    db.$client.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )
    `);
    db.$client
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("legacy-push-baseline-0016", compatibilityFloor.when);
  })();
}

function assertRequiredSchema(): void {
  const requirements: Record<string, string[]> = {
    transaction: ["id", "date", "tx_type", "subscription_id", "status", "reversal_of_tx_id"],
    account: ["id", "type", "liquidity_class"],
    category: ["id", "name", "reporting_account_id"],
    transaction_line: ["transaction_id", "account_id", "debit", "credit", "cash_flow_class"],
    money_anomaly_review: ["fingerprint", "kind", "transaction_id", "detected_amount", "reason", "status"],
    transaction_category_allocation: ["transaction_id", "category_id", "amount"],
    storage_deletion_outbox: ["r2_key", "status", "attempts"],
    pending_transaction: ["raw_message", "status"],
    splitbill_session: ["total_cents", "status"],
    reconciliation_session: ["as_of_date", "status", "lifecycle_status", "voided_at", "void_reason", "kind", "note"],
    reconciliation_item: ["session_id", "account_id", "difference", "status"],
    salary_period: ["id", "start_date", "end_date", "status", "closed_at", "reopened_at", "is_active", "archived_at", "coverage_status", "coverage_reason"],
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

