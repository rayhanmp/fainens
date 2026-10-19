CREATE TABLE IF NOT EXISTS `transaction_batch` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `source` text DEFAULT 'backfill' NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `note` text,
  `created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
  `posted_at` integer
);
--> statement-breakpoint
ALTER TABLE `transaction` ADD COLUMN `batch_id` integer REFERENCES `transaction_batch`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `transaction_batch_id_idx` ON `transaction` (`batch_id`);
