-- A trip's places, dates, currency and daily budget live in its goal's type data instead, where its headline reads them.
DROP TABLE IF EXISTS `goal_trip`;
--> statement-breakpoint
ALTER TABLE `goal_traveller` ADD `passport_number` text;
