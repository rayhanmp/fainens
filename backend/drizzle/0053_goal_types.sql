ALTER TABLE `savings_goal` ADD `goal_type` text;
--> statement-breakpoint
ALTER TABLE `savings_goal` ADD `type_data` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `goal_part` ADD `due_at` integer;
