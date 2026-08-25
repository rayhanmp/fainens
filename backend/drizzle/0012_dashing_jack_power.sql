CREATE TABLE `paylater_settlement_allocation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`settlement_tx_id` integer NOT NULL,
	`installment_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`settlement_tx_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installment_id`) REFERENCES `paylater_installment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_paylater_settlement_allocation_tx` ON `paylater_settlement_allocation` (`settlement_tx_id`);--> statement-breakpoint
CREATE INDEX `idx_paylater_settlement_allocation_installment` ON `paylater_settlement_allocation` (`installment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_paylater_settlement_allocation_unique` ON `paylater_settlement_allocation` (`settlement_tx_id`,`installment_id`);