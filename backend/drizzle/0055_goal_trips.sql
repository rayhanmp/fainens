CREATE TABLE IF NOT EXISTS `goal_trip` (
  `goal_id` integer PRIMARY KEY NOT NULL REFERENCES `savings_goal`(`id`) ON DELETE CASCADE,
  `places` text DEFAULT '[]' NOT NULL,
  `start_date` integer,
  `end_date` integer,
  `currency` text,
  `rate` real,
  `daily_budget` integer DEFAULT 0 NOT NULL,
  `climate` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goal_traveller` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `goal_id` integer NOT NULL REFERENCES `savings_goal`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `paying` integer DEFAULT 1 NOT NULL,
  `passport_expiry` integer,
  `visa_status` text DEFAULT 'not-needed' NOT NULL,
  `visa_date` integer,
  `insurance` text,
  `sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_goal_traveller_goal` ON `goal_traveller` (`goal_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goal_booking` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `goal_id` integer NOT NULL REFERENCES `savings_goal`(`id`) ON DELETE CASCADE,
  `kind` text DEFAULT 'other' NOT NULL,
  `title` text NOT NULL,
  `start_at` integer,
  `end_at` integer,
  `place` text,
  `address` text,
  `code` text,
  `cost` real DEFAULT 0 NOT NULL,
  `cost_currency` text DEFAULT 'IDR' NOT NULL,
  `cancel_by` integer,
  `details` text DEFAULT '{}' NOT NULL,
  `file_ids` text DEFAULT '[]' NOT NULL,
  `part_id` integer REFERENCES `goal_part`(`id`) ON DELETE SET NULL,
  `sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_goal_booking_goal` ON `goal_booking` (`goal_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goal_plan` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `goal_id` integer NOT NULL REFERENCES `savings_goal`(`id`) ON DELETE CASCADE,
  `day` text NOT NULL,
  `time` text,
  `title` text NOT NULL,
  `place` text,
  `cost` real DEFAULT 0 NOT NULL,
  `cost_currency` text DEFAULT 'IDR' NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_goal_plan_goal` ON `goal_plan` (`goal_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goal_packing` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `goal_id` integer NOT NULL REFERENCES `savings_goal`(`id`) ON DELETE CASCADE,
  `traveller_id` integer REFERENCES `goal_traveller`(`id`) ON DELETE CASCADE,
  `text` text NOT NULL,
  `done` integer DEFAULT 0 NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_goal_packing_goal` ON `goal_packing` (`goal_id`);
