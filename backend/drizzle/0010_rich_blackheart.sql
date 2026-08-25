ALTER TABLE `reconciliation_session` ADD `lifecycle_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `reconciliation_session` ADD `voided_at` integer;--> statement-breakpoint
ALTER TABLE `reconciliation_session` ADD `void_reason` text;