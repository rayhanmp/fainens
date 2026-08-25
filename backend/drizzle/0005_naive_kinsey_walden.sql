CREATE TABLE `recurring_occurrence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`schedule_id` integer NOT NULL,
	`occurrence_date` integer NOT NULL,
	`status` text NOT NULL,
	`transaction_id` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recurring_occurrence_identity` ON `recurring_occurrence` (`job_type`,`schedule_id`,`occurrence_date`);--> statement-breakpoint
CREATE INDEX `idx_recurring_occurrence_status` ON `recurring_occurrence` (`status`);