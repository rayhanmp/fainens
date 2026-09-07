ALTER TABLE `contact` ADD `kind` text DEFAULT 'person' NOT NULL;
--> statement-breakpoint
CREATE TABLE `reimbursement_claim` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `contact_id` integer NOT NULL REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE restrict,
  `title` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `due_date` integer,
  `notes` text,
  `submitted_at` integer,
  `approved_at` integer,
  `written_off_at` integer,
  `writeoff_transaction_id` integer REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE restrict,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reimbursement_claim_source` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `claim_id` integer NOT NULL REFERENCES `reimbursement_claim`(`id`) ON UPDATE no action ON DELETE cascade,
  `source_transaction_id` integer NOT NULL REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE restrict,
  `expense_line_id` integer NOT NULL REFERENCES `transaction_line`(`id`) ON UPDATE no action ON DELETE restrict,
  `category_id` integer REFERENCES `category`(`id`) ON UPDATE no action ON DELETE restrict,
  `amount` integer NOT NULL,
  `recognition_transaction_id` integer REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE restrict,
  `created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reimbursement_receipt` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `transaction_id` integer NOT NULL REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE restrict,
  `receipt_date` integer NOT NULL,
  `amount` integer NOT NULL,
  `status` text DEFAULT 'posted' NOT NULL,
  `reversal_transaction_id` integer REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE restrict,
  `reversal_reason` text,
  `notes` text,
  `created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reimbursement_receipt_allocation` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `receipt_id` integer NOT NULL REFERENCES `reimbursement_receipt`(`id`) ON UPDATE no action ON DELETE cascade,
  `claim_id` integer NOT NULL REFERENCES `reimbursement_claim`(`id`) ON UPDATE no action ON DELETE restrict,
  `amount` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reimbursement_operation` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `idempotency_key` text NOT NULL,
  `operation` text NOT NULL,
  `request_hash` text NOT NULL,
  `result_json` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reimbursement_operation_idempotency_key_unique` ON `reimbursement_operation` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_reimbursement_claim_contact` ON `reimbursement_claim` (`contact_id`);
--> statement-breakpoint
CREATE INDEX `idx_reimbursement_claim_status` ON `reimbursement_claim` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_reimbursement_claim_due_date` ON `reimbursement_claim` (`due_date`);
--> statement-breakpoint
CREATE INDEX `idx_reimbursement_source_claim` ON `reimbursement_claim_source` (`claim_id`);
--> statement-breakpoint
CREATE INDEX `idx_reimbursement_source_transaction` ON `reimbursement_claim_source` (`source_transaction_id`);
--> statement-breakpoint
CREATE INDEX `idx_reimbursement_source_expense_line` ON `reimbursement_claim_source` (`expense_line_id`);
--> statement-breakpoint
CREATE INDEX `idx_reimbursement_receipt_transaction` ON `reimbursement_receipt` (`transaction_id`);
--> statement-breakpoint
CREATE INDEX `idx_reimbursement_receipt_date` ON `reimbursement_receipt` (`receipt_date`);
--> statement-breakpoint
CREATE INDEX `idx_reimbursement_receipt_allocation_receipt` ON `reimbursement_receipt_allocation` (`receipt_id`);
--> statement-breakpoint
CREATE INDEX `idx_reimbursement_receipt_allocation_claim` ON `reimbursement_receipt_allocation` (`claim_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reimbursement_receipt_claim_unique` ON `reimbursement_receipt_allocation` (`receipt_id`,`claim_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `account` (`name`, `type`, `is_active`, `system_key`, `liquidity_class`)
VALUES ('Reimbursements Receivable', 'asset', 1, 'reimbursements-receivable', 'receivable');
