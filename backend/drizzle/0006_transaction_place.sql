PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `transaction` ADD COLUMN `place` text;--> statement-breakpoint
PRAGMA foreign_keys=ON;
