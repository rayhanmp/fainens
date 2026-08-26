CREATE TABLE `transaction_category_allocation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_transaction_category_allocation_tx` ON `transaction_category_allocation` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_transaction_category_allocation_category` ON `transaction_category_allocation` (`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transaction_category_allocation_unique` ON `transaction_category_allocation` (`transaction_id`,`category_id`);--> statement-breakpoint
ALTER TABLE `category` ADD `reporting_account_id` integer REFERENCES account(id);