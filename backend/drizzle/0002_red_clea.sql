CREATE TABLE `contact` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `loan_payment_attachment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_payment_id` integer NOT NULL,
	`filename` text NOT NULL,
	`r2_key` text NOT NULL,
	`mimetype` text NOT NULL,
	`file_size` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`loan_payment_id`) REFERENCES `loan_payment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_loan_payment_attachment_payment_id` ON `loan_payment_attachment` (`loan_payment_id`);--> statement-breakpoint
CREATE TABLE `loan_payment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`principal_cents` integer NOT NULL,
	`payment_date` integer NOT NULL,
	`transaction_id` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `loan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_loan_payment_loan_id` ON `loan_payment` (`loan_id`);--> statement-breakpoint
CREATE INDEX `idx_loan_payment_date` ON `loan_payment` (`payment_date`);--> statement-breakpoint
CREATE INDEX `idx_loan_payment_tx_id` ON `loan_payment` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `loan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`direction` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`remaining_cents` integer NOT NULL,
	`start_date` integer NOT NULL,
	`due_date` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`description` text,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_transaction_id` integer,
	`wallet_account_id` integer,
	`lending_transaction_id` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`wallet_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lending_transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_loan_contact_id` ON `loan` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_loan_direction` ON `loan` (`direction`);--> statement-breakpoint
CREATE INDEX `idx_loan_status` ON `loan` (`status`);--> statement-breakpoint
CREATE INDEX `idx_loan_start_date` ON `loan` (`start_date`);--> statement-breakpoint
CREATE INDEX `idx_loan_due_date` ON `loan` (`due_date`);--> statement-breakpoint
CREATE INDEX `idx_loan_source_tx_id` ON `loan` (`source_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_wishlist_category_id` ON `wishlist` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_wishlist_period_id` ON `wishlist` (`period_id`);--> statement-breakpoint
CREATE INDEX `idx_wishlist_status` ON `wishlist` (`status`);--> statement-breakpoint
CREATE INDEX `idx_wishlist_fulfilled_tx_id` ON `wishlist` (`fulfilled_transaction_id`);