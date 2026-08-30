ALTER TABLE `agent_message` ADD COLUMN `prompt_tokens` integer;
--> statement-breakpoint
ALTER TABLE `agent_message` ADD COLUMN `completion_tokens` integer;
--> statement-breakpoint
ALTER TABLE `agent_message` ADD COLUMN `total_tokens` integer;
--> statement-breakpoint
ALTER TABLE `agent_message` ADD COLUMN `estimated_cost_usd` real;
