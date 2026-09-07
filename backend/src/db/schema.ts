import { sqliteTable, integer, text, blob, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const categories: any = sqliteTable("category", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  icon: text("icon"),
  color: text("color"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  /** Optional expense/revenue account used for new categorized journal lines. */
  reportingAccountId: integer("reporting_account_id").references(() => accounts.id, { onDelete: "set null" }),
});

/** Wallet / ledger accounts — optional systemKey for internal GL accounts */
export const accounts: any = sqliteTable("account", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(), // asset, liability, equity, revenue, expense
  icon: text("icon"),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  systemKey: text("system_key").unique(),
  /** Extended fields for enhanced account management */
  description: text("description"),
  accountNumber: text("account_number"),
  creditLimit: integer("credit_limit"), // For credit cards (in cents)
  interestRate: integer("interest_rate"), // Annual interest rate (e.g., 12 for 12%)
  billingDate: integer("billing_date"), // Day of month (1-31)
  provider: text("provider"), // For PayLater: Kredivo, SPayLater, etc.
  parentId: integer("parent_id").references(() => accounts.id, { onDelete: "set null" }),
  /** Cash-flow/liquidity treatment for asset accounts; non-assets are non_cash. */
  liquidityClass: text("liquidity_class").notNull().default("non_cash"), // cash_equivalent | receivable | investment | non_cash
});

export const transactions: any = sqliteTable("transaction", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: integer("date", { mode: "timestamp_ms" }).notNull(),
  /** Optional due date for paylater recognition/interest installments (ms since epoch). */
  dueDate: integer("due_date", { mode: "timestamp_ms" }),
  description: text("description").notNull(),
  reference: text("reference"),
  notes: text("notes"),
  /** Optional place/location where the transaction occurred */
  place: text("place"),
  txType: text("tx_type").notNull().default("manual"),
  /** Posted journals are immutable; corrections use a linked reversal. */
  status: text("status").notNull().default("posted"), // posted | draft | reversed
  /** Period identity is referential; legacy unassigned journals remain null. */
  periodId: integer("period_id").references(() => salaryPeriods.id, { onDelete: "restrict" }),
  linkedTxId: integer("linked_tx_id"),
  reversalOfTxId: integer("reversal_of_tx_id").references(() => transactions.id, { onDelete: "set null" }),
  categoryId: integer("category_id").references(() => categories.id),
  /** Paylater installment metadata */
  installmentMonths: integer("installment_months"), // 1, 3, 6, 12
  interestRatePercent: integer("interest_rate_percent"), // Annual interest rate (e.g., 12 for 12%)
  adminFeeCents: integer("admin_fee_cents"), // One-time admin fee
  totalInstallments: integer("total_installments"), // Total number of installments
  /** Transport location tracking (for GoRide, Grab, etc.) */
  originLat: real("origin_lat"), // Origin latitude
  originLng: real("origin_lng"), // Origin longitude
  originName: text("origin_name"), // Origin place name (e.g., "Mall Kota Kasablanka")
  destLat: real("dest_lat"), // Destination latitude
  destLng: real("dest_lng"), // Destination longitude
  destName: text("dest_name"), // Destination place name
  distanceKm: real("distance_km"), // Distance in kilometers
  /** Optional subscription this transaction is paying for (advances subscription renewal) */
  subscriptionId: integer("subscription_id").references(() => subscriptions.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

/** Reusable transport routes. Amounts stay variable because fares change per trip. */
export const transportRouteTemplates: any = sqliteTable("transport_route_template", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  provider: text("provider"),
  service: text("service"),
  originName: text("origin_name"),
  originLat: real("origin_lat"),
  originLng: real("origin_lng"),
  destName: text("dest_name"),
  destLat: real("dest_lat"),
  destLng: real("dest_lng"),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  defaultAccountId: integer("default_account_id").references(() => accounts.id, { onDelete: "set null" }),
  notes: text("notes"),
  tagIds: text("tag_ids").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
});

export const transactionLines = sqliteTable("transaction_line", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  transactionId: integer("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  debit: integer("debit").notNull().default(0), // cents
  credit: integer("credit").notNull().default(0), // cents
  description: text("description"),
  /** Explicit cash-flow treatment for a cash-equivalent line. */
  cashFlowClass: text("cash_flow_class"), // operating | investing | financing | transfer | recovery
});

/** Explicit category amounts for a journal; supports multi-category journals. */
export const transactionCategoryAllocations = sqliteTable("transaction_category_allocation", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  transactionId: integer("transaction_id").notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").notNull()
    .references(() => categories.id),
  amount: integer("amount").notNull(), // signed net expense (refunds are negative)
}, (table) => ({
  transactionIdx: index("idx_transaction_category_allocation_tx").on(table.transactionId),
  categoryIdx: index("idx_transaction_category_allocation_category").on(table.categoryId),
  uniqueAllocation: uniqueIndex("idx_transaction_category_allocation_unique").on(table.transactionId, table.categoryId),
}));

export const tags = sqliteTable("tag", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull(),
});

export const transactionTags = sqliteTable("transaction_tag", {
  transactionId: integer("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  tagId: integer("tag_id")
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
});

/** Paylater installment schedule for tracking individual installments */
export const paylaterInstallments = sqliteTable("paylater_installment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recognitionTxId: integer("recognition_tx_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  installmentNumber: integer("installment_number").notNull(), // 1, 2, 3...
  totalInstallments: integer("total_installments").notNull(), // 1, 3, 6, 12
  dueDate: integer("due_date", { mode: "timestamp_ms" }).notNull(),
  principalCents: integer("principal_cents").notNull(),      // Portion of principal
  interestCents: integer("interest_cents").notNull().default(0), // Interest for this installment
  feeCents: integer("fee_cents").notNull().default(0),      // Admin/service fee
  totalCents: integer("total_cents").notNull(),             // principal + interest + fee
  paidCents: integer("paid_cents").notNull().default(0),   // Amount allocated from settlements
  status: text("status").notNull().default("pending"),      // pending, paid, overdue
  paidTxId: integer("paid_tx_id"),                          // Link to settlement transaction
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

/** Exact installment allocations for every PayLater settlement. */
export const paylaterSettlementAllocations = sqliteTable("paylater_settlement_allocation", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  settlementTxId: integer("settlement_tx_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  installmentId: integer("installment_id")
    .notNull()
    .references(() => paylaterInstallments.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  settlementTxIdx: index("idx_paylater_settlement_allocation_tx").on(table.settlementTxId),
  installmentIdx: index("idx_paylater_settlement_allocation_installment").on(table.installmentId),
  settlementInstallmentUnique: uniqueIndex("idx_paylater_settlement_allocation_unique")
    .on(table.settlementTxId, table.installmentId),
}));

export const salaryPeriods = sqliteTable("salary_period", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  startDate: integer("start_date").notNull(), // ms since epoch
  endDate: integer("end_date").notNull(),
  /** An accounting close prevents new or backdated journals from changing history. */
  status: text("status").notNull().default("open"), // open | closed
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  reopenedAt: integer("reopened_at", { mode: "timestamp_ms" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  /** Completeness of captured activity; independent from open/closed/archive lifecycle. */
  coverageStatus: text("coverage_status").notNull().default("unknown"), // complete | partial | skipped | unknown
  coverageReason: text("coverage_reason"),
});

export const budgetPlans = sqliteTable("budget_plan", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  periodId: integer("period_id")
    .notNull()
    .references(() => salaryPeriods.id, { onDelete: "cascade" }),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  plannedAmount: integer("planned_amount").notNull(), // cents
});

/** Optional revision-bound adjudication of historical spending patterns. */
export const forecastReviews = sqliteTable("forecast_review", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  periodId: integer("period_id").notNull().references(() => salaryPeriods.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
  evidenceRevision: integer("evidence_revision").notNull(),
  classification: text("classification").notNull(),
  weight: real("weight").notNull(),
  confidence: real("confidence").notNull(),
  rationale: text("rationale").notNull(),
  evidencePeriodIds: text("evidence_period_ids").notNull().default("[]"),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  status: text("status").notNull().default("active"),
  userWeight: real("user_weight"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  periodCategoryIdx: uniqueIndex("idx_forecast_review_period_category").on(table.periodId, table.categoryId),
  revisionIdx: index("idx_forecast_review_revision").on(table.evidenceRevision),
}));

/** Per-transaction pattern adjudication used to adjust historical samples. */
export const forecastPurchaseReviews = sqliteTable("forecast_purchase_review", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  transactionId: integer("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  transactionDate: integer("transaction_date").notNull(),
  periodId: integer("period_id").notNull().references(() => salaryPeriods.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  evidenceRevision: integer("evidence_revision").notNull(),
  classification: text("classification").notNull(),
  weight: real("weight").notNull(),
  confidence: real("confidence").notNull(),
  rationale: text("rationale").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  status: text("status").notNull().default("active"),
  userWeight: real("user_weight"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  transactionIdx: uniqueIndex("idx_forecast_purchase_review_transaction").on(table.transactionId),
  revisionIdx: index("idx_forecast_purchase_review_revision").on(table.evidenceRevision),
}));

export const budgetTemplates = sqliteTable("budget_template", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

export const budgetTemplateItems = sqliteTable("budget_template_item", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  templateId: integer("template_id")
    .notNull()
    .references(() => budgetTemplates.id, { onDelete: "cascade" }),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  plannedAmount: integer("planned_amount").notNull(), // cents
  sortOrder: integer("sort_order").notNull().default(0),
});

export const attachments = sqliteTable("attachment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  transactionId: integer("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  r2Key: text("r2_key").notNull(),
  mimetype: text("mimetype").notNull(),
  fileSize: integer("file_size").notNull(),
});

/**
 * Durable cleanup work for objects whose owning database row has been removed.
 * The row is committed with the domain deletion, so a transient R2/local-storage
 * failure never discards the only key needed to retry cleanup.
 */
export const storageDeletionOutbox = sqliteTable("storage_deletion_outbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  r2Key: text("r2_key").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
}, (table) => ({
  statusIdx: index("idx_storage_deletion_outbox_status").on(table.status),
}));

/** A dated control snapshot; it never represents an economic transaction. */
export const reconciliationSessions = sqliteTable("reconciliation_session", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  asOfDate: integer("as_of_date", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull(), // reconciled | needs_classification
  /** Control-evidence lifecycle; a void never alters the ledger. */
  lifecycleStatus: text("lifecycle_status").notNull().default("active"), // active | voided
  voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
  voidReason: text("void_reason"),
  /** A control snapshot never posts; recovery snapshots may post one disclosed bridge journal. */
  kind: text("kind").notNull().default("control"), // control | recovery
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

export const reconciliationItems = sqliteTable("reconciliation_item", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id")
    .notNull()
    .references(() => reconciliationSessions.id, { onDelete: "cascade" }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  ledgerBalance: integer("ledger_balance").notNull(),
  actualBalance: integer("actual_balance").notNull(),
  difference: integer("difference").notNull(),
  status: text("status").notNull(), // matched | needs_classification
  correctionTransactionId: integer("correction_transaction_id")
    .references(() => transactions.id, { onDelete: "set null" }),
}, (table) => ({
  sessionAccountUnique: uniqueIndex("idx_reconciliation_item_session_account")
    .on(table.sessionId, table.accountId),
  accountIdx: index("idx_reconciliation_item_account").on(table.accountId),
}));

/** Durable identity and outcome for every inferred recurring financial event. */
export const recurringOccurrences = sqliteTable("recurring_occurrence", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type").notNull(),
  scheduleId: integer("schedule_id").notNull(),
  occurrenceDate: integer("occurrence_date", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull(), // pending | posted | skipped | failed
  transactionId: integer("transaction_id")
    .references(() => transactions.id, { onDelete: "set null" }),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  occurrenceUnique: uniqueIndex("idx_recurring_occurrence_identity")
    .on(table.jobType, table.scheduleId, table.occurrenceDate),
  statusIdx: index("idx_recurring_occurrence_status").on(table.status),
}));

/** Durable revision for all financial facts and subledger state. */
export const financialState = sqliteTable("financial_state", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

/** Durable cache invalidation work. Redis is an optimization; committed
 * ledger mutations enqueue rebuild work so a Redis outage cannot leave stale
 * values around after the connection returns. */
export const cacheInvalidationOutbox = sqliteTable("cache_invalidation_outbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  operation: text("operation").notNull(), // account | period | analytics | insights | all
  accountId: integer("account_id"),
  periodId: integer("period_id"),
  revision: integer("revision").notNull(),
  status: text("status").notNull().default("pending"), // pending | failed | processed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
}, (table) => ({
  statusIdx: index("idx_cache_invalidation_outbox_status").on(table.status, table.createdAt),
}));

/** Durable receipt for asynchronous, non-financial work.  Financial records
 * remain in their domain tables and must never rely on a BullMQ job as their
 * only source of truth.  The task row lets the dispatcher recover a job when
 * SQLite commits successfully but Redis is temporarily unavailable. */
export const backgroundTasks: any = sqliteTable("background_task", {
  id: text("id").primaryKey(),
  queueName: text("queue_name").notNull(),
  jobName: text("job_name").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  ownerEmail: text("owner_email"),
  subjectType: text("subject_type"),
  subjectId: text("subject_id"),
  payloadJson: text("payload_json").notNull().default("{}"),
  resultJson: text("result_json"),
  status: text("status").notNull().default("queued"), // queued | running | retrying | completed | failed | cancelled
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  availableAt: integer("available_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  dedupeIdx: uniqueIndex("idx_background_task_queue_dedupe").on(table.queueName, table.dedupeKey),
  statusIdx: index("idx_background_task_status_available").on(table.status, table.availableAt),
  ownerIdx: index("idx_background_task_owner_created").on(table.ownerEmail, table.createdAt),
  subjectIdx: index("idx_background_task_subject").on(table.subjectType, table.subjectId),
}));

export const auditLogs = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(), // create, update, delete
  beforeSnapshot: blob("before_snapshot", { mode: "buffer" }),
  afterSnapshot: blob("after_snapshot", { mode: "buffer" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

/**
 * Human-reviewed data-quality flags. Scanning is deliberately separate from
 * correction: a candidate never changes a journal or account balance.
 */
export const moneyAnomalyReviews = sqliteTable("money_anomaly_review", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fingerprint: text("fingerprint").notNull().unique(),
  kind: text("kind").notNull(), // possible_100x_pair | legacy_reconciliation_plug
  transactionId: integer("transaction_id").notNull()
    .references(() => transactions.id, { onDelete: "restrict" }),
  relatedTransactionId: integer("related_transaction_id")
    .references(() => transactions.id, { onDelete: "restrict" }),
  detectedAmount: integer("detected_amount").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // open | resolved | dismissed
  reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
  reviewNote: text("review_note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  statusIdx: index("idx_money_anomaly_review_status").on(table.status),
  transactionIdx: index("idx_money_anomaly_review_transaction").on(table.transactionId),
}));

/** Singleton salary profile for payroll estimates (gross, PTKP, payday). */
export const salarySettings = sqliteTable("salary_settings", {
  id: integer("id").primaryKey(),
  grossMonthly: integer("gross_monthly").notNull().default(0), // whole IDR (same unit as ledger)
  payrollDay: integer("payroll_day").notNull().default(25),
  ptkpCode: text("ptkp_code").notNull().default("TK0"),
  /** Account ID where salary will be deposited on payroll day */
  depositAccountId: integer("deposit_account_id").references(() => accounts.id, { onDelete: "set null" }),
  /** PMK 168/2023 TER settings */
  terCategory: text("ter_category").notNull().default("A"), // A, B, or C
  jkkRiskGrade: integer("jkk_risk_grade").notNull().default(24), // Stored as basis points (0.24% = 24)
  jkmRate: integer("jkm_rate").notNull().default(30), // Stored as basis points (0.3% = 30)
  bpjsKesehatanActive: integer("bpjs_kesehatan_active", { mode: "boolean" }).notNull().default(true),
  jpWageCap: integer("jp_wage_cap").notNull().default(10_042_300),
  bpjsKesWageCap: integer("bpjs_kes_wage_cap").notNull().default(12_000_000),
  jhtWageCap: integer("jht_wage_cap").notNull().default(12_000_000),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

/** Server-only agent provider configuration. The API key is encrypted and is
 * never serialized to the browser; environment variables remain the fallback. */
export const agentProviderSettings = sqliteTable("agent_provider_settings", {
  id: integer("id").primaryKey(),
  model: text("model").notNull(),
  apiKeyCiphertext: text("api_key_ciphertext"),
  apiKeyUpdatedAt: integer("api_key_updated_at", { mode: "timestamp_ms" }),
});

/** User-managed OpenAI-compatible Agent model definitions. API keys are
 * encrypted at rest and never serialized to the client. */
export const agentModels = sqliteTable("agent_model", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  model: text("model").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKeyCiphertext: text("api_key_ciphertext"),
  apiKeyUpdatedAt: integer("api_key_updated_at", { mode: "timestamp_ms" }),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  defaultIdx: index("idx_agent_model_default").on(table.isDefault),
}));

/** Recurring subscriptions / bills (amounts in whole IDR, same as formatCurrency in app). */
export const subscriptions = sqliteTable("subscription", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** Required link to a wallet/account for payment. */
  linkedAccountId: integer("linked_account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  /** Optional category for posted renewal expenses. */
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  /** Charge amount in whole Rupiah. */
  amount: integer("amount").notNull(),
  /** Billing cycle: monthly | annual */
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  nextRenewalAt: integer("next_renewal_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull().default("active"), // active | paused
  /** UI icon key: car | film | music | signal | sparkles | default */
  iconKey: text("icon_key").notNull().default("default"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

/** Wishlist items - planned purchases/goals before they become real transactions */
export const wishlist = sqliteTable("wishlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  /** Amount in cents */
  amount: integer("amount").notNull(),
  /** Category for organizing wishlist items */
  categoryId: integer("category_id")
    .references(() => categories.id, { onDelete: "set null" }),
  /** Optional period assignment for savings planning */
  periodId: integer("period_id")
    .references(() => salaryPeriods.id, { onDelete: "set null" }),
  /** Status: active | fulfilled | cancelled */
  status: text("status").notNull().default("active"),
  /** When the wishlist item was fulfilled */
  fulfilledAt: integer("fulfilled_at", { mode: "timestamp_ms" }),
  /** Link to the actual transaction when fulfilled */
  fulfilledTransactionId: integer("fulfilled_transaction_id")
    .references(() => transactions.id, { onDelete: "set null" }),
  /** Product image R2 key (from URL scraping) */
  imageUrl: text("image_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  categoryIdIdx: index("idx_wishlist_category_id").on(table.categoryId),
  periodIdIdx: index("idx_wishlist_period_id").on(table.periodId),
  statusIdx: index("idx_wishlist_status").on(table.status),
  fulfilledTxIdx: index("idx_wishlist_fulfilled_tx_id").on(table.fulfilledTransactionId),
}));

// Indexes for performance optimization
export const transactionsDateIdx = index("idx_transactions_date").on(transactions.date);
export const transactionsPeriodIdx = index("idx_transactions_period_id").on(transactions.periodId);
export const transactionsCategoryIdx = index("idx_transactions_category_id").on(transactions.categoryId);
export const transactionsTypeIdx = index("idx_transactions_tx_type").on(transactions.txType);
export const transactionLinesTransactionIdx = index("idx_transaction_lines_tx_id").on(transactionLines.transactionId);
export const transactionLinesAccountIdx = index("idx_transaction_lines_account_id").on(transactionLines.accountId);
export const transactionTagsTransactionIdx = index("idx_transaction_tags_tx_id").on(transactionTags.transactionId);
export const transactionTagsTagIdx = index("idx_transaction_tags_tag_id").on(transactionTags.tagId);
export const paylaterInstallmentsTxIdx = index("idx_paylater_installments_tx_id").on(paylaterInstallments.recognitionTxId);
export const subscriptionsLinkedAccountIdx = index("idx_subscriptions_account_id").on(subscriptions.linkedAccountId);

/** Contacts - people you lend to or borrow from */
export const contacts = sqliteTable("contact", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** A contact can be a person (loans/split bills) or an organization (for example an employer). */
  kind: text("kind").notNull().default("person"), // person | organization
  fullName: text("full_name"),
  email: text("email"),
  phone: text("phone"),
  relationshipType: text("relationship_type"),
  notes: text("notes"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

/** Loans - tracks money lent to or borrowed from contacts */
export const loans = sqliteTable("loan", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactId: integer("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // 'lent' | 'borrowed' - from YOUR perspective
  amountCents: integer("amount_cents").notNull(),
  remainingCents: integer("remaining_cents").notNull(),
  startDate: integer("start_date", { mode: "timestamp_ms" }).notNull(),
  dueDate: integer("due_date", { mode: "timestamp_ms" }),
  status: text("status").notNull().default("active"), // active, repaid, defaulted, written_off
  description: text("description"),
  /** Source of the loan (manual entry or split bill) */
  sourceType: text("source_type").notNull().default("manual"), // manual, split_bill
  sourceTransactionId: integer("source_transaction_id")
    .references(() => transactions.id, { onDelete: "set null" }),
  /** The wallet/account involved in the original transaction */
  walletAccountId: integer("wallet_account_id")
    .references(() => accounts.id, { onDelete: "set null" }),
  /** The transaction that created this loan */
  lendingTransactionId: integer("lending_transaction_id")
    .references(() => transactions.id, { onDelete: "set null" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  contactIdIdx: index("idx_loan_contact_id").on(table.contactId),
  directionIdx: index("idx_loan_direction").on(table.direction),
  statusIdx: index("idx_loan_status").on(table.status),
  startDateIdx: index("idx_loan_start_date").on(table.startDate),
  dueDateIdx: index("idx_loan_due_date").on(table.dueDate),
  sourceTxIdx: index("idx_loan_source_tx_id").on(table.sourceTransactionId),
}));

/** Loan Payments - tracks repayments on loans */
export const loanPayments = sqliteTable("loan_payment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loanId: integer("loan_id")
    .notNull()
    .references(() => loans.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  principalCents: integer("principal_cents").notNull(),
  paymentDate: integer("payment_date", { mode: "timestamp_ms" }).notNull(),
  /** The transaction that recorded this payment */
  transactionId: integer("transaction_id")
    .references(() => transactions.id, { onDelete: "set null" }),
  /** Posted payments are retained when corrected; their inverse is linked here. */
  status: text("status").notNull().default("posted"), // posted | reversed
  reversalTransactionId: integer("reversal_transaction_id")
    .references(() => transactions.id, { onDelete: "set null" }),
  reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
  reversalReason: text("reversal_reason"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  loanIdIdx: index("idx_loan_payment_loan_id").on(table.loanId),
  paymentDateIdx: index("idx_loan_payment_date").on(table.paymentDate),
  transactionIdIdx: index("idx_loan_payment_tx_id").on(table.transactionId),
}));

/** Loan Payment Attachments - receipts for loan payments */
export const loanPaymentAttachments = sqliteTable("loan_payment_attachment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loanPaymentId: integer("loan_payment_id")
    .notNull()
    .references(() => loanPayments.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  r2Key: text("r2_key").notNull(),
  mimetype: text("mimetype").notNull(),
  fileSize: integer("file_size").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  loanPaymentIdIdx: index("idx_loan_payment_attachment_payment_id").on(table.loanPaymentId),
}));

/**
 * A reimbursement is a claim against a contact, not a transaction category.
 * Draft/submitted claims are planning records; only approved claims have a GL
 * balance in the Reimbursements Receivable control account.
 */
export const reimbursementClaims = sqliteTable("reimbursement_claim", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactId: integer("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"), // draft | submitted | approved | partially_paid | settled | rejected | cancelled | written_off
  dueDate: integer("due_date", { mode: "timestamp_ms" }),
  notes: text("notes"),
  submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
  writtenOffAt: integer("written_off_at", { mode: "timestamp_ms" }),
  writeoffTransactionId: integer("writeoff_transaction_id").references(() => transactions.id, { onDelete: "restrict" }),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  contactIdx: index("idx_reimbursement_claim_contact").on(table.contactId),
  statusIdx: index("idx_reimbursement_claim_status").on(table.status),
  dueDateIdx: index("idx_reimbursement_claim_due_date").on(table.dueDate),
}));

/** Exact expense/category portions claimed from an original posted transaction. */
export const reimbursementClaimSources = sqliteTable("reimbursement_claim_source", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  claimId: integer("claim_id").notNull().references(() => reimbursementClaims.id, { onDelete: "cascade" }),
  sourceTransactionId: integer("source_transaction_id").notNull().references(() => transactions.id, { onDelete: "restrict" }),
  expenseLineId: integer("expense_line_id").notNull().references(() => transactionLines.id, { onDelete: "restrict" }),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "restrict" }),
  amount: integer("amount").notNull(),
  recognitionTransactionId: integer("recognition_transaction_id").references(() => transactions.id, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  claimIdx: index("idx_reimbursement_source_claim").on(table.claimId),
  sourceTxIdx: index("idx_reimbursement_source_transaction").on(table.sourceTransactionId),
  expenseLineIdx: index("idx_reimbursement_source_expense_line").on(table.expenseLineId),
}));

/** A posted cash receipt may be allocated across several claims. */
export const reimbursementReceipts = sqliteTable("reimbursement_receipt", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  transactionId: integer("transaction_id").notNull().references(() => transactions.id, { onDelete: "restrict" }),
  receiptDate: integer("receipt_date", { mode: "timestamp_ms" }).notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("posted"), // posted | reversed
  reversalTransactionId: integer("reversal_transaction_id").references(() => transactions.id, { onDelete: "restrict" }),
  reversalReason: text("reversal_reason"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  transactionIdx: index("idx_reimbursement_receipt_transaction").on(table.transactionId),
  dateIdx: index("idx_reimbursement_receipt_date").on(table.receiptDate),
}));

export const reimbursementReceiptAllocations = sqliteTable("reimbursement_receipt_allocation", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptId: integer("receipt_id").notNull().references(() => reimbursementReceipts.id, { onDelete: "cascade" }),
  claimId: integer("claim_id").notNull().references(() => reimbursementClaims.id, { onDelete: "restrict" }),
  amount: integer("amount").notNull(),
}, (table) => ({
  receiptIdx: index("idx_reimbursement_receipt_allocation_receipt").on(table.receiptId),
  claimIdx: index("idx_reimbursement_receipt_allocation_claim").on(table.claimId),
  receiptClaimUnique: uniqueIndex("idx_reimbursement_receipt_claim_unique").on(table.receiptId, table.claimId),
}));

/** Durable replay protection for commands that create financial journals. */
export const reimbursementOperations = sqliteTable("reimbursement_operation", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  operation: text("operation").notNull(),
  requestHash: text("request_hash").notNull(),
  resultJson: text("result_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('now') * 1000)`),
});

// Additional indexes for contacts
export const contactsNameIdx = index("idx_contacts_name").on(contacts.name);
export const contactsIsActiveIdx = index("idx_contacts_is_active").on(contacts.isActive);

/** Durable user-owned conversation metadata for the finance agent. */
export const agentConversations = sqliteTable("agent_conversation", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email").notNull(),
  title: text("title").notNull().default("New conversation"),
  /** auto until the user explicitly edits the title; manual titles are never overwritten. */
  titleSource: text("title_source").notNull().default("auto"), // auto | manual
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  /** Deterministic compact context for messages older than the recent window. */
  summary: text("summary"),
  summaryThroughMessageId: integer("summary_through_message_id").notNull().default(0),
}, (table) => ({
  ownerUpdatedIdx: index("idx_agent_conversation_owner_updated").on(table.ownerEmail, table.updatedAt),
  ownerStateIdx: index("idx_agent_conversation_owner_state").on(table.ownerEmail, table.archivedAt, table.isPinned, table.updatedAt),
}));

/** User-maintained profile context supplied to the finance agent. Memories are
 * deliberately separate from conversation history and financial records. */
export const agentMemories = sqliteTable("agent_memory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email").notNull(),
  label: text("label").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  ownerUpdatedIdx: index("idx_agent_memory_owner_updated").on(table.ownerEmail, table.updatedAt),
}));

/** Durable per-user agent preferences. Kept separate from free-form memories
 * so identity/display preferences can be edited without mixing them into
 * contextual notes. */
export const agentProfiles = sqliteTable("agent_profile", {
  ownerEmail: text("owner_email").primaryKey(),
  nickname: text("nickname"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

/**
 * Persist only the user-visible exchange and structured response receipt.
 * Tool results are retained as evidence for that answer, not supplied as a
 * stale substitute for the next turn's fresh retrieval.
 */
export const agentMessages = sqliteTable("agent_message", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => agentConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  responseJson: text("response_json"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  estimatedCostUsd: real("estimated_cost_usd"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  conversationCreatedIdx: index("idx_agent_message_conversation_created").on(table.conversationId, table.createdAt),
}));

/** Compact, user-conversation-scoped insights explicitly retained by the
 * model. They are derived context and become stale after a revision change. */
export const agentConversationInsights = sqliteTable("agent_conversation_insight", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => agentConversations.id, { onDelete: "cascade" }),
  claim: text("claim").notNull(),
  evidenceIds: text("evidence_ids").notNull(),
  financialRevision: integer("financial_revision").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  conversationStatusIdx: index("idx_agent_conversation_insight_status").on(table.conversationId, table.status, table.updatedAt),
}));

/** Image attachments retained with an Agent user message for conversation reloads. */
export const agentMessageAttachments = sqliteTable("agent_message_attachment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id")
    .notNull()
    .references(() => agentMessages.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => agentConversations.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimetype: text("mimetype").notNull(),
  r2Key: text("r2_key").notNull(),
  fileSize: integer("file_size").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  messageIdIdx: index("idx_agent_message_attachment_message_id").on(table.messageId),
  conversationIdIdx: index("idx_agent_message_attachment_conversation_id").on(table.conversationId),
}));

/**
 * Durable, owner-scoped mutation proposals created by the finance agent.
 * The normalized payload and financial revision are immutable evidence for
 * the approval boundary; execution must revalidate both before writing.
 */
export const agentPendingActions = sqliteTable("agent_pending_action", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email").notNull(),
  conversationId: integer("conversation_id")
    .references(() => agentConversations.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  normalizedInput: text("normalized_input").notNull(),
  assumptions: text("assumptions"),
  missingFields: text("missing_fields"),
  /** Links independently approved proposals prepared from one multi-transaction request. */
  batchId: text("batch_id"),
  baseFinancialRevision: integer("base_financial_revision").notNull(),
  status: text("status").notNull().default("pending"), // pending | executed | rejected | expired | superseded | failed
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  ownerStatusIdx: index("idx_agent_pending_action_owner_status").on(table.ownerEmail, table.status, table.createdAt),
  conversationIdx: index("idx_agent_pending_action_conversation").on(table.conversationId, table.createdAt),
  batchIdx: index("idx_agent_pending_action_batch").on(table.batchId, table.status),
}));

/**
 * One-time approval credentials for a pending action. Only a SHA-256 hash of
 * the bearer token is stored, and the idempotency key makes retries return a
 * single execution receipt instead of repeating the mutation.
 */
export const agentApprovals = sqliteTable("agent_approval", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pendingActionId: integer("pending_action_id")
    .notNull()
    .references(() => agentPendingActions.id, { onDelete: "cascade" }),
  ownerEmail: text("owner_email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status").notNull().default("pending"), // pending | executed | rejected | expired | superseded | failed
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
  executedAt: integer("executed_at", { mode: "timestamp_ms" }),
  executionReceipt: text("execution_receipt"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  ownerStatusIdx: index("idx_agent_approval_owner_status").on(table.ownerEmail, table.status, table.createdAt),
  pendingActionIdx: index("idx_agent_approval_pending_action").on(table.pendingActionId),
}));

/** Pending transactions from WhatsApp/other sources - waiting for user approval */
export const pendingTransactions = sqliteTable("pending_transaction", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Original raw message from user */
  rawMessage: text("raw_message").notNull(),
  /** Parsed transaction data as JSON */
  parsedData: text("parsed_data").notNull(),
  /** Status: pending, approved, rejected, failed */
  status: text("status").notNull().default("pending"),
  /** Number of parsing attempts */
  parseAttempts: integer("parse_attempts").notNull().default(0),
  /** Last parsing error message */
  lastError: text("last_error"),
  /** User message ID for responding */
  userMessageId: text("user_message_id"),
  /** Source (e.g., whatsapp, telegram) */
  source: text("source").notNull().default("whatsapp"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

/** Splitbill sessions - stores receipt OCR and split history */
export const splitbillSessions = sqliteTable("splitbill_session", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  merchantName: text("merchant_name"),
  receiptDate: integer("receipt_date", { mode: "timestamp_ms" }),
  receiptImageR2Key: text("receipt_image_r2_key"),

  parsedItemsJson: text("parsed_items_json"),
  subtotalCents: integer("subtotal_cents"),
  taxCents: integer("tax_cents"),
  serviceFeeCents: integer("service_fee_cents"),
  discountCents: integer("discount_cents"),
  totalCents: integer("total_cents").notNull(),

  peopleJson: text("people_json"),
  assignmentsJson: text("assignments_json"),

  splitResultJson: text("split_result_json"),

  loanIds: text("loan_ids"),

  status: text("status").notNull().default("pending"),

  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
}, (table) => ({
  statusIdx: index("idx_splitbill_status").on(table.status),
  createdAtIdx: index("idx_splitbill_created_at").on(table.createdAt),
}));
