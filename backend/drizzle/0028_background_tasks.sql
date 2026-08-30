CREATE TABLE IF NOT EXISTS `background_task` (
	`id` text PRIMARY KEY NOT NULL,
	`queue_name` text NOT NULL,
	`job_name` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`owner_email` text,
	`subject_type` text,
	`subject_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`available_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_background_task_queue_dedupe` ON `background_task` (`queue_name`,`dedupe_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_background_task_status_available` ON `background_task` (`status`,`available_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_background_task_owner_created` ON `background_task` (`owner_email`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_background_task_subject` ON `background_task` (`subject_type`,`subject_id`);
