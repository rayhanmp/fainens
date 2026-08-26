ALTER TABLE `reconciliation_session` ADD `kind` text DEFAULT 'control' NOT NULL;--> statement-breakpoint
ALTER TABLE `reconciliation_session` ADD `note` text;--> statement-breakpoint
ALTER TABLE `salary_period` ADD `coverage_status` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_period` ADD `coverage_reason` text;