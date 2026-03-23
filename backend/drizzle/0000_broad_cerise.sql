CREATE TABLE `account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`icon` text,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`system_key` text,
	`description` text,
	`account_number` text,
	`credit_limit` integer,
	`interest_rate` integer,
	`billing_date` integer,
	`provider` text,
	`parent_id` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_system_key_unique` ON `account` (`system_key`);--> statement-breakpoint
CREATE TABLE `attachment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`filename` text NOT NULL,
	`r2_key` text NOT NULL,
	`mimetype` text NOT NULL,
	`file_size` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`action` text NOT NULL,
	`before_snapshot` blob,
	`after_snapshot` blob,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budget_plan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`planned_amount` integer NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `salary_period`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `budget_template_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`planned_amount` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `budget_template`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `budget_template` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text
);
--> statement-breakpoint
CREATE TABLE `paylater_installment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recognition_tx_id` integer NOT NULL,
	`installment_number` integer NOT NULL,
	`total_installments` integer NOT NULL,
	`due_date` integer NOT NULL,
	`principal_cents` integer NOT NULL,
	`interest_cents` integer DEFAULT 0 NOT NULL,
	`fee_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_tx_id` integer,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`recognition_tx_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `salary_period` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`start_date` integer NOT NULL,
	`end_date` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `salary_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`gross_monthly` integer DEFAULT 0 NOT NULL,
	`payroll_day` integer DEFAULT 25 NOT NULL,
	`ptkp_code` text DEFAULT 'TK0' NOT NULL,
	`deposit_account_id` integer,
	`ter_category` text DEFAULT 'A' NOT NULL,
	`jkk_risk_grade` integer DEFAULT 24 NOT NULL,
	`jkm_rate` integer DEFAULT 30 NOT NULL,
	`bpjs_kesehatan_active` integer DEFAULT true NOT NULL,
	`jp_wage_cap` integer DEFAULT 10042300 NOT NULL,
	`bpjs_kes_wage_cap` integer DEFAULT 12000000 NOT NULL,
	`jht_wage_cap` integer DEFAULT 12000000 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`deposit_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`linked_account_id` integer NOT NULL,
	`category_id` integer,
	`amount` integer NOT NULL,
	`billing_cycle` text DEFAULT 'monthly' NOT NULL,
	`next_renewal_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`icon_key` text DEFAULT 'default' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`linked_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_line` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`debit` integer DEFAULT 0 NOT NULL,
	`credit` integer DEFAULT 0 NOT NULL,
	`description` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transaction_tag` (
	`transaction_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transaction` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` integer NOT NULL,
	`due_date` integer,
	`description` text NOT NULL,
	`reference` text,
	`notes` text,
	`place` text,
	`tx_type` text DEFAULT 'manual' NOT NULL,
	`period_id` integer,
	`linked_tx_id` integer,
	`category_id` integer,
	`installment_months` integer,
	`interest_rate_percent` integer,
	`admin_fee_cents` integer,
	`total_installments` integer,
	`origin_lat` real,
	`origin_lng` real,
	`origin_name` text,
	`dest_lat` real,
	`dest_lng` real,
	`dest_name` text,
	`distance_km` real,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `wishlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`amount` integer NOT NULL,
	`category_id` integer,
	`period_id` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`fulfilled_at` integer,
	`fulfilled_transaction_id` integer,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`period_id`) REFERENCES `salary_period`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`fulfilled_transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE set null
);
