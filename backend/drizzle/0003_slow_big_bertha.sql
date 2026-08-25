CREATE TABLE `pending_transaction` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`raw_message` text NOT NULL,
	`parsed_data` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`parse_attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`user_message_id` text,
	`source` text DEFAULT 'whatsapp' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `splitbill_session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_name` text,
	`receipt_date` integer,
	`receipt_image_r2_key` text,
	`parsed_items_json` text,
	`subtotal_cents` integer,
	`tax_cents` integer,
	`service_fee_cents` integer,
	`discount_cents` integer,
	`total_cents` integer NOT NULL,
	`people_json` text,
	`assignments_json` text,
	`split_result_json` text,
	`loan_ids` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_splitbill_status` ON `splitbill_session` (`status`);--> statement-breakpoint
CREATE INDEX `idx_splitbill_created_at` ON `splitbill_session` (`created_at`);--> statement-breakpoint
CREATE TABLE `storage_deletion_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`r2_key` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_storage_deletion_outbox_status` ON `storage_deletion_outbox` (`status`);--> statement-breakpoint
ALTER TABLE `contact` ADD `full_name` text;--> statement-breakpoint
ALTER TABLE `contact` ADD `relationship_type` text;--> statement-breakpoint
ALTER TABLE `transaction` ADD `subscription_id` integer REFERENCES subscription(id);