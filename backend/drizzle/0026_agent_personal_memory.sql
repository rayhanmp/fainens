CREATE TABLE `agent_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`label` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agent_memory_owner_updated` ON `agent_memory` (`owner_email`,`updated_at`);
