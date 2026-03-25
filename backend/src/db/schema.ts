import { sqliteTable, integer, text, blob, real, index } from "drizzle-orm/sqlite-core";
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
  fullName: text("full_name"),
  nickname: text("nickname"),
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

// Additional indexes for contacts
export const contactsNameIdx = index("idx_contacts_name").on(contacts.name);
export const contactsIsActiveIdx = index("idx_contacts_is_active").on(contacts.isActive);

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
