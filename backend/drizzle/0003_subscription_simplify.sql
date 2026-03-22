PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_subscription` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`linked_account_id` integer NOT NULL,
	`category_id` integer,
	`amount` integer NOT NULL,
	`billing_cycle` text DEFAULT 'monthly' NOT NULL,
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
INSERT INTO `__new_subscription`("id", "name", "linked_account_id", "category_id", "amount", "billing_cycle", "next_renewal_at", "status", "icon_key", "sort_order", "created_at", "updated_at") 
SELECT "id", "name", "linked_account_id", "category_id", "amount_monthly", 'monthly', "next_renewal_at", "status", "icon_key", "sort_order", "created_at", "updated_at" FROM `subscription`;--> statement-breakpoint
DROP TABLE `subscription`;--> statement-breakpoint
ALTER TABLE `__new_subscription` RENAME TO `subscription`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
