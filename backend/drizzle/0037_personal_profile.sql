CREATE TABLE IF NOT EXISTS `agent_profile` (
  `owner_email` text PRIMARY KEY NOT NULL,
  `nickname` text,
  `updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `full_name` text;
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `preferred_name` text;
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `pronouns` text;
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `date_of_birth` text;
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `country` text;
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `timezone` text NOT NULL DEFAULT 'Asia/Jakarta';
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `language` text NOT NULL DEFAULT 'en';
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `currency` text NOT NULL DEFAULT 'IDR';
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `income_pattern` text;
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `primary_goal` text;
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `agent_tone` text NOT NULL DEFAULT 'warm';
--> statement-breakpoint
ALTER TABLE `agent_profile` ADD COLUMN `agent_verbosity` text NOT NULL DEFAULT 'concise';
--> statement-breakpoint
UPDATE `agent_profile`
SET `preferred_name` = `nickname`
WHERE `preferred_name` IS NULL AND `nickname` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `agent_profile` RENAME TO `user_profile`;
