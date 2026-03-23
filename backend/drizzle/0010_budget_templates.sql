PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- Create budget templates table
CREATE TABLE `budget_template` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint

-- Create budget template items table
CREATE TABLE `budget_template_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`planned_amount` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `budget_template`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

PRAGMA foreign_keys=ON;
