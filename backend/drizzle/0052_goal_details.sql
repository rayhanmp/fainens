ALTER TABLE `savings_goal` ADD `monthly_percent` real;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `icon` text;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `description` text;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `link_url` text;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `link_title` text;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `link_image` text;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `account_id` integer REFERENCES `account`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `expected_return` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `recurrence` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `paused_at` integer;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `category_id` integer REFERENCES `category`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `category_since` integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goal_part` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `goal_id` integer NOT NULL REFERENCES `savings_goal`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `amount` integer NOT NULL,
  `paid_at` integer,
  `transaction_id` integer REFERENCES `transaction`(`id`) ON DELETE SET NULL,
  `sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_goal_part_goal` ON `goal_part` (`goal_id`);
--> statement-breakpoint
ALTER TABLE `goal_allocation` ADD `part_id` integer REFERENCES `goal_part`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goal_attachment` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `goal_id` integer NOT NULL REFERENCES `savings_goal`(`id`) ON DELETE CASCADE,
  `filename` text NOT NULL,
  `r2_key` text NOT NULL,
  `mimetype` text NOT NULL,
  `file_size` integer NOT NULL,
  `is_cover` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_goal_attachment_goal` ON `goal_attachment` (`goal_id`);
--> statement-breakpoint
ALTER TABLE `goal_settings` ADD `auto_fund_on_payday` integer DEFAULT 0 NOT NULL;
