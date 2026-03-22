PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- Add new columns to transactions table for installment metadata
ALTER TABLE `transaction` ADD COLUMN `installment_months` integer;--> statement-breakpoint
ALTER TABLE `transaction` ADD COLUMN `interest_rate_percent` integer;--> statement-breakpoint
ALTER TABLE `transaction` ADD COLUMN `admin_fee_cents` integer;--> statement-breakpoint
ALTER TABLE `transaction` ADD COLUMN `total_installments` integer;--> statement-breakpoint

-- Create paylater_installments table
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

PRAGMA foreign_keys=ON;
