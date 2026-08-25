-- Preserve journals while repairing only dangling legacy references. A null
-- period is the established fallback for pre-FK rows and remains date-scoped.
UPDATE `transaction`
SET `period_id` = NULL
WHERE `period_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `salary_period` WHERE `salary_period`.`id` = `transaction`.`period_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transaction` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` integer NOT NULL,
	`due_date` integer,
	`description` text NOT NULL,
	`reference` text,
	`notes` text,
	`place` text,
	`tx_type` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`period_id` integer,
	`linked_tx_id` integer,
	`reversal_of_tx_id` integer,
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
	`subscription_id` integer,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `salary_period`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reversal_of_tx_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscription`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_transaction`("id", "date", "due_date", "description", "reference", "notes", "place", "tx_type", "status", "period_id", "linked_tx_id", "reversal_of_tx_id", "category_id", "installment_months", "interest_rate_percent", "admin_fee_cents", "total_installments", "origin_lat", "origin_lng", "origin_name", "dest_lat", "dest_lng", "dest_name", "distance_km", "subscription_id", "created_at") SELECT "id", "date", "due_date", "description", "reference", "notes", "place", "tx_type", "status", "period_id", "linked_tx_id", "reversal_of_tx_id", "category_id", "installment_months", "interest_rate_percent", "admin_fee_cents", "total_installments", "origin_lat", "origin_lng", "origin_name", "dest_lat", "dest_lng", "dest_name", "distance_km", "subscription_id", "created_at" FROM `transaction`;--> statement-breakpoint
DROP TABLE `transaction`;--> statement-breakpoint
ALTER TABLE `__new_transaction` RENAME TO `transaction`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_transactions_date` ON `transaction` (`date`);--> statement-breakpoint
CREATE INDEX `idx_transactions_period_id` ON `transaction` (`period_id`);--> statement-breakpoint
CREATE INDEX `idx_transactions_category_id` ON `transaction` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_transactions_tx_type` ON `transaction` (`tx_type`);
