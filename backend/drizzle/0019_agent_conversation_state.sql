CREATE TABLE `agent_conversation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`title` text DEFAULT 'New conversation' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agent_conversation_owner_updated` ON `agent_conversation` (`owner_email`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `agent_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL REFERENCES `agent_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`response_json` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agent_message_conversation_created` ON `agent_message` (`conversation_id`,`created_at`);
