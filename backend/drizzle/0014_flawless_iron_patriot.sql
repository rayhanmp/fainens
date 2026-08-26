ALTER TABLE `account` ADD `liquidity_class` text DEFAULT 'non_cash' NOT NULL;
--> statement-breakpoint
UPDATE `account` SET `liquidity_class` = 'cash_equivalent' WHERE `type` = 'asset';
--> statement-breakpoint
UPDATE `account` SET `liquidity_class` = 'receivable' WHERE `system_key` = 'loans-receivable';
