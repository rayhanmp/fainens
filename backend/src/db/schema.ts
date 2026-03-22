import { sqliteTable, integer, text, blob } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const categories: any = sqliteTable("category", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  icon: text("icon"),
  color: text("color"),
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
});

export const transactions = sqliteTable("transaction", {
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
  periodId: integer("period_id"),
  linkedTxId: integer("linked_tx_id"),
  categoryId: integer("category_id").references(() => categories.id),
  /** Paylater installment metadata */
  installmentMonths: integer("installment_months"), // 1, 3, 6, 12
  interestRatePercent: integer("interest_rate_percent"), // Annual interest rate (e.g., 12 for 12%)
  adminFeeCents: integer("admin_fee_cents"), // One-time admin fee
  totalInstallments: integer("total_installments"), // Total number of installments
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
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
});

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
  status: text("status").notNull().default("pending"),      // pending, paid, overdue
  paidTxId: integer("paid_tx_id"),                          // Link to settlement transaction
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
});

export const salaryPeriods = sqliteTable("salary_period", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  startDate: integer("start_date").notNull(), // ms since epoch
  endDate: integer("end_date").notNull(),
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
