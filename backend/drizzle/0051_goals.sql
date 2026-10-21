CREATE TABLE IF NOT EXISTS `savings_goal` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `target_amount` integer NOT NULL,
  `by_date` integer,
  `kind` text DEFAULT 'spend' NOT NULL,
  `monthly_amount` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `wishlist_id` integer REFERENCES `wishlist`(`id`) ON DELETE SET NULL,
  `spent_transaction_id` integer REFERENCES `transaction`(`id`) ON DELETE SET NULL,
  `done_at` integer,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goal_allocation` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `goal_id` integer NOT NULL REFERENCES `savings_goal`(`id`) ON DELETE CASCADE,
  `amount` integer NOT NULL,
  `kind` text DEFAULT 'assign' NOT NULL,
  `note` text,
  `transaction_id` integer REFERENCES `transaction`(`id`) ON DELETE SET NULL,
  `created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_goal_allocation_goal` ON `goal_allocation` (`goal_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goal_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `excluded_account_ids` text DEFAULT '[]' NOT NULL
);
