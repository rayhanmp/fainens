ALTER TABLE `salary_period` ADD `budget_note` text;--> statement-breakpoint
ALTER TABLE `salary_period` ADD `savings_target_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_period` ADD `savings_target_mode` text DEFAULT 'amount' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_period` ADD `savings_target_rate` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `budget_plan` ADD `note` text;
