ALTER TABLE `agent_conversation` ADD `title_source` text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
-- Existing non-placeholder titles may have been manually edited before this
-- field existed. Preserve them as locked titles; only untouched conversations
-- remain eligible for automatic generation.
UPDATE `agent_conversation` SET `title_source` = 'manual' WHERE `title` <> 'New conversation';
