PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `salary_settings` ADD COLUMN `deposit_account_id` integer REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
PRAGMA foreign_keys=ON;
