ALTER TABLE `loan_payment` ADD `status` text DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE `loan_payment` ADD `reversal_transaction_id` integer REFERENCES transaction(id);--> statement-breakpoint
ALTER TABLE `loan_payment` ADD `reversed_at` integer;--> statement-breakpoint
ALTER TABLE `loan_payment` ADD `reversal_reason` text;