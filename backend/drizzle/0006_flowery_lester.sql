CREATE TABLE IF NOT EXISTS `financial_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `financial_state` (`id`, `revision`) VALUES (1, 0);
