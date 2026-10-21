CREATE TABLE IF NOT EXISTS `goal_note_page` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `goal_id` integer NOT NULL REFERENCES `savings_goal`(`id`) ON DELETE CASCADE,
  `title` text NOT NULL,
  `content` text DEFAULT '' NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_goal_note_page_goal` ON `goal_note_page` (`goal_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goal_note_version` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `page_id` integer NOT NULL REFERENCES `goal_note_page`(`id`) ON DELETE CASCADE,
  `content` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_goal_note_version_page` ON `goal_note_version` (`page_id`);
--> statement-breakpoint
INSERT INTO `goal_note_page` (`goal_id`, `title`, `content`, `sort_order`)
  SELECT `id`, 'Notes', `description`, 0 FROM `savings_goal` WHERE `description` IS NOT NULL AND trim(`description`) != '';
