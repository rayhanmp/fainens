CREATE TABLE IF NOT EXISTS `agent_message_attachment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL REFERENCES `agent_message`(`id`) ON UPDATE no action ON DELETE cascade,
	`conversation_id` integer NOT NULL REFERENCES `agent_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	`filename` text NOT NULL,
	`mimetype` text NOT NULL,
	`r2_key` text NOT NULL,
	`file_size` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_agent_message_attachment_message_id` ON `agent_message_attachment` (`message_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_agent_message_attachment_conversation_id` ON `agent_message_attachment` (`conversation_id`);
