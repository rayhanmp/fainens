CREATE TABLE `agent_model` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key_ciphertext` text,
	`api_key_updated_at` integer,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agent_model_default` ON `agent_model` (`is_default`);
--> statement-breakpoint
INSERT INTO `agent_model` (`name`, `model`, `base_url`, `api_key_ciphertext`, `api_key_updated_at`, `is_default`)
SELECT `model`, `model`, 'https://openrouter.ai/api/v1', `api_key_ciphertext`, `api_key_updated_at`, 1
FROM `agent_provider_settings`
WHERE `id` = 1;
