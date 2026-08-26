ALTER TABLE `agent_conversation` ADD `is_pinned` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `agent_conversation` ADD `archived_at` integer;
--> statement-breakpoint
CREATE INDEX `idx_agent_conversation_owner_state` ON `agent_conversation` (`owner_email`,`archived_at`,`is_pinned`,`updated_at`);
