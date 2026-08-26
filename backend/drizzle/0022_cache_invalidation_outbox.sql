CREATE TABLE IF NOT EXISTS `cache_invalidation_outbox` (
	`id` integer PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`account_id` integer,
	`period_id` integer,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cache_invalidation_outbox_status` ON `cache_invalidation_outbox` (`status`,`created_at`);
