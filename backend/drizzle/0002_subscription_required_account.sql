PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- Delete subscriptions without a linked account (cannot be migrated)
DELETE FROM `subscription` WHERE `linked_account_id` IS NULL;--> statement-breakpoint
CREATE TABLE `__new_subscription` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`linked_to` text NOT NULL,
	`linked_account_id` integer NOT NULL,
	`category_id` integer,
	`amount_monthly` integer NOT NULL,
	`next_renewal_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`icon_key` text DEFAULT 'default' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`linked_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_subscription`("id", "name", "linked_to", "linked_account_id", "category_id", "amount_monthly", "next_renewal_at", "status", "icon_key", "sort_order", "created_at", "updated_at") SELECT "id", "name", "linked_to", "linked_account_id", "category_id", "amount_monthly", "next_renewal_at", "status", "icon_key", "sort_order", "created_at", "updated_at" FROM `subscription`;--> statement-breakpoint
DROP TABLE `subscription`;--> statement-breakpoint
ALTER TABLE `__new_subscription` RENAME TO `subscription`;--> statement-breakpoint
PRAGMA foreign_keys=ON;