CREATE TABLE `money_anomaly_review` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`kind` text NOT NULL,
	`transaction_id` integer NOT NULL,
	`related_transaction_id` integer,
	`detected_amount` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reviewed_at` integer,
	`review_note` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`related_transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `money_anomaly_review_fingerprint_unique` ON `money_anomaly_review` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_money_anomaly_review_status` ON `money_anomaly_review` (`status`);--> statement-breakpoint
CREATE INDEX `idx_money_anomaly_review_transaction` ON `money_anomaly_review` (`transaction_id`);--> statement-breakpoint
ALTER TABLE `transaction_line` ADD `cash_flow_class` text;