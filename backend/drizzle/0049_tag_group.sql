CREATE TABLE IF NOT EXISTS `tag_group` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tag` ADD COLUMN `group_id` integer REFERENCES `tag_group`(`id`) ON DELETE SET NULL;
