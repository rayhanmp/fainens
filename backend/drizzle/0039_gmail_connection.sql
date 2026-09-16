CREATE TABLE IF NOT EXISTS `gmail_connection` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`google_email` text NOT NULL,
	`refresh_token` text NOT NULL,
	`last_synced_at` integer,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
