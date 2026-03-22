PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `salary_settings` ADD COLUMN `ter_category` text DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_settings` ADD COLUMN `jkk_risk_grade` integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_settings` ADD COLUMN `jkm_rate` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_settings` ADD COLUMN `bpjs_kesehatan_active` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_settings` ADD COLUMN `jp_wage_cap` integer DEFAULT 10042300 NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_settings` ADD COLUMN `bpjs_kes_wage_cap` integer DEFAULT 12000000 NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_settings` ADD COLUMN `jht_wage_cap` integer DEFAULT 12000000 NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=ON;
