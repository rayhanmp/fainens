ALTER TABLE `agent_conversation` ADD COLUMN `summary` text;
--> statement-breakpoint
ALTER TABLE `agent_conversation` ADD COLUMN `summary_through_message_id` integer NOT NULL DEFAULT 0;
