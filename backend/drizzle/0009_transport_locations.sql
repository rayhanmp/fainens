PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- Add transport location tracking columns for GoRide, Grab, Gojek, etc. expenses
ALTER TABLE `transaction` ADD COLUMN `origin_lat` real;--> statement-breakpoint
ALTER TABLE `transaction` ADD COLUMN `origin_lng` real;--> statement-breakpoint
ALTER TABLE `transaction` ADD COLUMN `origin_name` text;--> statement-breakpoint
ALTER TABLE `transaction` ADD COLUMN `dest_lat` real;--> statement-breakpoint
ALTER TABLE `transaction` ADD COLUMN `dest_lng` real;--> statement-breakpoint
ALTER TABLE `transaction` ADD COLUMN `dest_name` text;--> statement-breakpoint
ALTER TABLE `transaction` ADD COLUMN `distance_km` real;--> statement-breakpoint

PRAGMA foreign_keys=ON;
