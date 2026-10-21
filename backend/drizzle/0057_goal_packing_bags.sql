ALTER TABLE `goal_packing` ADD `category` text DEFAULT 'other' NOT NULL;
--> statement-breakpoint
ALTER TABLE `goal_packing` ADD `quantity` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `goal_packing` ADD `bag` text;
