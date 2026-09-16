CREATE TABLE IF NOT EXISTS `database_backup_settings` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`frequency` text DEFAULT 'weekly' NOT NULL CHECK (`frequency` IN ('weekly', 'biweekly', 'monthly', 'quarterly')),
	`last_backup_at` integer,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
