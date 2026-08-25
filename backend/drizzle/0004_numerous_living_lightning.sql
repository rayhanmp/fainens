CREATE TABLE `reconciliation_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`ledger_balance` integer NOT NULL,
	`actual_balance` integer NOT NULL,
	`difference` integer NOT NULL,
	`status` text NOT NULL,
	`correction_transaction_id` integer,
	FOREIGN KEY (`session_id`) REFERENCES `reconciliation_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`correction_transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reconciliation_item_session_account` ON `reconciliation_item` (`session_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_item_account` ON `reconciliation_item` (`account_id`);--> statement-breakpoint
CREATE TABLE `reconciliation_session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`as_of_date` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
