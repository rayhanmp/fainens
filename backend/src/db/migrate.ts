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
    // A number of older `db push` installs created Drizzle's history table
    // but never recorded a row. Treat that empty table like absent history:
    // the schema is already present and needs the compatibility baseline,
    // otherwise Drizzle starts again at 0000 and tries to recreate `account`.
    if (rows.length > 0 && !isLegacyPush) return;
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
    "0025_agent_action_batches": has("agent_pending_action", "batch_id"),
    "0026_agent_personal_memory": has("agent_memory", "id", "owner_email", "label", "content", "created_at", "updated_at"),
    "0027_agent_conversation_titles": has("agent_conversation", "title_source"),
    "0029_agent_message_attachments": has("agent_message_attachment", "id", "message_id", "conversation_id", "filename", "mimetype", "r2_key", "file_size", "created_at"),
    "0030_agent_token_usage": has("agent_message", "prompt_tokens", "completion_tokens", "total_tokens", "estimated_cost_usd"),
    "0031_agent_conversation_summary": has("agent_conversation", "summary", "summary_through_message_id"),
    "0034_reimbursements": has("contact", "kind")
      && has("reimbursement_claim", "contact_id", "status", "version")
      && has("reimbursement_claim_source", "claim_id", "expense_line_id", "recognition_transaction_id")
      && has("reimbursement_receipt", "transaction_id", "status", "reversal_transaction_id")
      && has("reimbursement_receipt_allocation", "receipt_id", "claim_id", "amount")
      && has("reimbursement_operation", "idempotency_key", "operation", "request_hash", "result_json"),
    "0035_reimbursement_writeoff_reversal": has("reimbursement_claim", "writeoff_transaction_id"),
    "0036_agent_models": has("agent_model", "id", "name", "model", "base_url", "is_default"),
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

/**
 * User profile preferences are additive and owner-scoped. Keep this small
 * compatibility ensure separate from the generated migration stream so
 * legacy databases and fresh databases both receive the table idempotently.
 */
function ensureUserProfileTable(): void {
  db.$client.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      owner_email text PRIMARY KEY NOT NULL,
      full_name text,
      preferred_name text,
      nickname text,
      pronouns text,
      date_of_birth text,
      country text,
      timezone text DEFAULT 'Asia/Jakarta' NOT NULL,
      language text DEFAULT 'en' NOT NULL,
      currency text DEFAULT 'IDR' NOT NULL,
      income_pattern text,
      primary_goal text,
      agent_tone text DEFAULT 'warm' NOT NULL,
      agent_verbosity text DEFAULT 'concise' NOT NULL,
      agent_context_preferences text DEFAULT '{"fullName":false,"preferredName":true,"pronouns":false,"age":false,"country":false,"timezone":true,"language":true,"currency":true,"incomePattern":false,"primaryGoal":false,"agentTone":true,"agentVerbosity":true}' NOT NULL,
      updated_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL
    )
  `);
}

function ensureForecastReviewTable(): void {
  db.$client.exec(`
    CREATE TABLE IF NOT EXISTS forecast_review (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      period_id integer NOT NULL REFERENCES salary_period(id) ON DELETE CASCADE,
      category_id integer NOT NULL REFERENCES category(id) ON DELETE CASCADE,
      evidence_revision integer NOT NULL,
      classification text NOT NULL,
      weight real NOT NULL,
      confidence real NOT NULL,
      rationale text NOT NULL,
      evidence_period_ids text DEFAULT '[]' NOT NULL,
      model text NOT NULL,
      prompt_version text NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      user_weight real,
      created_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
      UNIQUE(period_id, category_id)
    );
    CREATE INDEX IF NOT EXISTS idx_forecast_review_revision ON forecast_review(evidence_revision);
    CREATE TABLE IF NOT EXISTS forecast_purchase_review (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      transaction_id integer NOT NULL REFERENCES "transaction"(id) ON DELETE CASCADE,
      transaction_date integer NOT NULL,
      period_id integer NOT NULL REFERENCES salary_period(id) ON DELETE CASCADE,
      category_id integer NOT NULL REFERENCES category(id) ON DELETE CASCADE,
      amount integer NOT NULL,
      evidence_revision integer NOT NULL,
      classification text NOT NULL,
      weight real NOT NULL,
      confidence real NOT NULL,
      rationale text NOT NULL,
      model text NOT NULL,
      prompt_version text NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      user_weight real,
      created_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
      UNIQUE(transaction_id)
    );
    CREATE INDEX IF NOT EXISTS idx_forecast_purchase_review_revision ON forecast_purchase_review(evidence_revision);
  `);
  if (tableExists("forecast_purchase_review") && !columnExists("forecast_purchase_review", "transaction_date")) {
    db.$client.exec("ALTER TABLE forecast_purchase_review ADD COLUMN transaction_date integer DEFAULT 0 NOT NULL");
  }
}

function ensureTransportRouteTemplateTable(): void {
  db.$client.exec(`
    CREATE TABLE IF NOT EXISTS transport_route_template (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      name text NOT NULL,
      provider text,
      service text,
      origin_name text,
      origin_lat real,
      origin_lng real,
      dest_name text,
      dest_lat real,
      dest_lng real,
      category_id integer REFERENCES category(id) ON DELETE SET NULL,
      default_account_id integer REFERENCES account(id) ON DELETE SET NULL,
      notes text,
      tag_ids text DEFAULT '[]' NOT NULL,
      created_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transport_route_template_updated_at ON transport_route_template(updated_at);
  `);
  for (const column of ["origin_lat", "origin_lng", "dest_lat", "dest_lng"] as const) {
    if (!columnExists("transport_route_template", column)) {
      db.$client.exec(`ALTER TABLE transport_route_template ADD COLUMN ${column} real`);
    }
  }
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
    background_task: ["id", "queue_name", "job_name", "dedupe_key", "status", "attempts", "max_attempts", "available_at", "created_at", "updated_at"],
    agent_conversation: ["id", "owner_email", "title", "title_source", "created_at", "updated_at", "is_pinned", "archived_at", "summary", "summary_through_message_id"],
    agent_message: ["id", "conversation_id", "role", "content", "created_at", "prompt_tokens", "completion_tokens", "total_tokens", "estimated_cost_usd"],
    agent_message_attachment: ["id", "message_id", "conversation_id", "filename", "mimetype", "r2_key", "file_size", "created_at"],
    agent_pending_action: ["id", "owner_email", "conversation_id", "kind", "normalized_input", "batch_id", "base_financial_revision", "status", "expires_at", "created_at", "updated_at"],
    agent_approval: ["id", "pending_action_id", "owner_email", "token_hash", "idempotency_key", "status", "approved_at", "executed_at", "execution_receipt", "expires_at", "created_at"],
    agent_memory: ["id", "owner_email", "label", "content", "created_at", "updated_at"],
    user_profile: ["owner_email", "full_name", "preferred_name", "nickname", "pronouns", "date_of_birth", "country", "timezone", "language", "currency", "income_pattern", "primary_goal", "agent_tone", "agent_verbosity", "agent_context_preferences", "updated_at"],
    forecast_review: ["period_id", "category_id", "evidence_revision", "classification", "weight", "confidence", "rationale", "status"],
    forecast_purchase_review: ["transaction_id", "transaction_date", "period_id", "category_id", "amount", "evidence_revision", "classification", "weight", "confidence", "rationale", "status"],
    transport_route_template: ["id", "name", "provider", "service", "origin_name", "origin_lat", "origin_lng", "dest_name", "dest_lat", "dest_lng", "category_id", "default_account_id", "notes", "tag_ids", "created_at", "updated_at"],
    contact: ["id", "name", "kind", "is_active"],
    reimbursement_claim: ["id", "contact_id", "title", "status", "version", "writeoff_transaction_id", "created_at", "updated_at"],
    reimbursement_claim_source: ["id", "claim_id", "source_transaction_id", "expense_line_id", "category_id", "amount", "recognition_transaction_id"],
    reimbursement_receipt: ["id", "transaction_id", "receipt_date", "amount", "status", "reversal_transaction_id"],
    reimbursement_receipt_allocation: ["id", "receipt_id", "claim_id", "amount"],
    reimbursement_operation: ["id", "idempotency_key", "operation", "request_hash", "result_json"],
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
  // migration in __drizzle_migrations before the post-migration schema
  // assertion runs. Startup must fail closed if the schema cannot be brought
  // to the checked-in version.
  migrate(db, { migrationsFolder });
  ensureUserProfileTable();
  ensureForecastReviewTable();
  ensureTransportRouteTemplateTable();
  assertRequiredSchema();
  repairActiveReturnPeriodCoverage();
  await seedDb(db);
}

