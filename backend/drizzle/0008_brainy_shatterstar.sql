ALTER TABLE `transaction` ADD `status` text DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE `transaction` ADD `reversal_of_tx_id` integer REFERENCES transaction(id);