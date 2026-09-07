ALTER TABLE `reimbursement_claim` ADD `writeoff_transaction_id` integer REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE restrict;
