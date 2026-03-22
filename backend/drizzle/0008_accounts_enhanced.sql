PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- Add new columns to accounts table for enhanced account management
ALTER TABLE `account` ADD COLUMN `description` text;--> statement-breakpoint
ALTER TABLE `account` ADD COLUMN `account_number` text;--> statement-breakpoint
ALTER TABLE `account` ADD COLUMN `credit_limit` integer;--> statement-breakpoint
ALTER TABLE `account` ADD COLUMN `interest_rate` integer;--> statement-breakpoint
ALTER TABLE `account` ADD COLUMN `billing_date` integer;--> statement-breakpoint
ALTER TABLE `account` ADD COLUMN `provider` text;--> statement-breakpoint
ALTER TABLE `account` ADD COLUMN `parent_id` integer REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint

PRAGMA foreign_keys=ON;
