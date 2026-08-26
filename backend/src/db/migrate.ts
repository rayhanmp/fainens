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

function triggerExists(name: string): boolean {
  return Boolean(db.$client.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ? LIMIT 1",
  ).get(name));
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

/**
 * A few early deployments used `db push` and later switched to checked-in
 * migrations. Those databases can have the post-migration schema but an
 * incomplete __drizzle_migrations history. Drizzle only compares the latest
 * timestamp, so it would replay CREATE/ALTER statements and fail with
 * "already exists". When every object owned by a migration is already
 * present, record a synthetic history row and let the normal migrator continue
 * from the first genuinely missing schema change. This is additive and never
 * removes user data.
 */
function repairMigrationHistory(journal: MigrationJournal): void {
  db.$client.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  // Some pushed databases already contain the outbox table but predate the
  // trigger migration. Installing this idempotently before history repair
  // lets us safely baseline both objects without replaying a later ALTER.
  if (tableExists("financial_state") && tableExists("cache_invalidation_outbox") && !triggerExists("cache_invalidation_on_revision")) {
    db.$client.exec(`
      CREATE TRIGGER IF NOT EXISTS cache_invalidation_on_revision
      AFTER UPDATE OF revision ON financial_state
      WHEN NEW.revision <> OLD.revision
      BEGIN
        INSERT INTO cache_invalidation_outbox (operation, revision, status, attempts)
        VALUES ('all', NEW.revision, 'pending', 0);
      END;
    `);
  }

  const has = (table: string, ...columns: string[]) =>
    tableExists(table) && columns.every((column) => columnExists(table, column));
  const satisfied: Record<string, boolean> = {
    "0006_flowery_lester": has("financial_state", "id", "revision", "updated_at"),
    "0010_rich_blackheart": has("reconciliation_session", "lifecycle_status", "voided_at", "void_reason"),
    "0012_dashing_jack_power": has("paylater_settlement_allocation", "settlement_tx_id", "installment_id", "amount_cents"),
    "0014_flawless_iron_patriot": has("account", "liquidity_class"),
    "0015_aromatic_mentallo": has("transaction_category_allocation", "transaction_id", "category_id", "amount") && has("category", "reporting_account_id"),
    "0016_ancient_the_executioner": has("salary_period", "is_active", "archived_at"),
    "0017_premium_strong_guy": has("money_anomaly_review", "fingerprint", "kind", "transaction_id", "detected_amount", "reason", "status") && has("transaction_line", "cash_flow_class"),
    "0018_sharp_patch": has("reconciliation_session", "kind", "note") && has("salary_period", "coverage_status", "coverage_reason"),
    "0019_agent_conversation_state": has("agent_conversation", "id", "owner_email", "title") && has("agent_message", "id", "conversation_id", "role", "content"),
    "0020_agent_conversation_lifecycle": has("agent_conversation", "is_pinned", "archived_at"),
    "0021_agent_action_approval": has("agent_pending_action", "id", "owner_email", "kind", "status") && has("agent_approval", "id", "pending_action_id", "token_hash", "status"),
    "0022_cache_invalidation_outbox": has("cache_invalidation_outbox", "id", "operation", "revision", "status", "attempts", "created_at"),
    "0023_revision_cache_outbox_trigger": triggerExists("cache_invalidation_on_revision"),
    "0024_category_archive_lifecycle": has("category", "is_active"),
  };
  const rows = db.$client.prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1").all() as Array<{ created_at: number }>;
  let latest = rows.length > 0 ? Number(rows[0].created_at) : 0;
  const repairRows: Array<{ tag: string; when: number }> = [];
  for (const entry of journal.entries) {
    if (!satisfied[entry.tag] || entry.when <= latest) continue;
    // Do not jump over a missing migration. A later schema object may have
    // been created manually, but earlier migrations still need to run.
    const prior = journal.entries.filter((candidate) => candidate.when < entry.when);
    if (prior.some((candidate) => satisfied[candidate.tag] === false)) continue;
    repairRows.push(entry);
    latest = entry.when;
  }
  if (repairRows.length === 0) return;
  const insert = db.$client.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)");
  db.$client.transaction(() => {
    for (const entry of repairRows) {
      insert.run(`schema-repair-${entry.tag}`, entry.when);
    }
  })();
}

function assertRequiredSchema(): void {
  const requirements: Record<string, string[]> = {
    transaction: ["id", "date", "tx_type", "subscription_id", "status", "reversal_of_tx_id"],
    account: ["id", "type", "liquidity_class"],
    category: ["id", "name", "is_active", "reporting_account_id"],
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
    cache_invalidation_outbox: ["id", "operation", "revision", "status", "attempts", "created_at"],
    agent_conversation: ["id", "owner_email", "title", "created_at", "updated_at", "is_pinned", "archived_at"],
    agent_message: ["id", "conversation_id", "role", "content", "created_at"],
    agent_pending_action: ["id", "owner_email", "conversation_id", "kind", "normalized_input", "base_financial_revision", "status", "expires_at", "created_at", "updated_at"],
    agent_approval: ["id", "pending_action_id", "owner_email", "token_hash", "idempotency_key", "status", "approved_at", "executed_at", "execution_receipt", "expires_at", "created_at"],
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

/**
 * Version 0018 introduced coverage after some return shells had already been
 * created. The original return flow accidentally labelled its active current
 * shell as skipped along with historical gaps. Correct that known semantic bug
 * in place, preserving a coverage warning and an audit record rather than
 * pretending the period is fully complete.
 */
function repairActiveReturnPeriodCoverage(): void {
  if (!tableExists("salary_period") || !tableExists("audit_log") || !tableExists("financial_state")) return;
  const rows = db.$client.prepare(`
    SELECT id, name, start_date, end_date, status, is_active, coverage_status, coverage_reason
    FROM salary_period
    WHERE status = 'open'
      AND is_active = 1
      AND coverage_status = 'skipped'
      AND coverage_reason = 'return_after_absence'
  `).all() as Array<Record<string, unknown>>;
  if (rows.length === 0) return;
  const now = Date.now();
  db.$client.transaction(() => {
    const update = db.$client.prepare(`
      UPDATE salary_period
      SET coverage_status = 'partial', coverage_reason = 'return_started_current_period'
      WHERE id = ? AND status = 'open' AND is_active = 1
        AND coverage_status = 'skipped' AND coverage_reason = 'return_after_absence'
    `);
    const audit = db.$client.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, before_snapshot, after_snapshot, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    let repaired = 0;
    for (const row of rows) {
      const result = update.run(row.id);
      if (result.changes !== 1) continue;
      repaired += 1;
      audit.run(
        "salary_period",
        row.id,
        "repair_return_current_period_coverage",
        Buffer.from(JSON.stringify(row)),
        Buffer.from(JSON.stringify({ ...row, coverage_status: "partial", coverage_reason: "return_started_current_period" })),
        now,
      );
    }
    if (repaired > 0) {
      db.$client.prepare("UPDATE financial_state SET revision = revision + 1, updated_at = ? WHERE id = 1").run(now);
    }
  })();
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
  repairMigrationHistory(journal);

  // The better-sqlite3 migrator is synchronous and records every applied
  // migration in __drizzle_migrations. Startup must fail closed if the schema
  // cannot be brought to the checked-in version.
  migrate(db, { migrationsFolder });
  assertRequiredSchema();
  repairActiveReturnPeriodCoverage();
  await seedDb(db);
}

