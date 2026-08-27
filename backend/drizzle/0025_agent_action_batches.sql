ALTER TABLE `agent_pending_action` ADD `batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_agent_pending_action_batch` ON `agent_pending_action` (`batch_id`,`status`);
