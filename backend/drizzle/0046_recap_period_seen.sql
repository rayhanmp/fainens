CREATE TABLE IF NOT EXISTS `recap_period_highlight_seen` (
  `owner_email` text NOT NULL,
  `period_id` integer NOT NULL REFERENCES `salary_period`(`id`) ON DELETE CASCADE,
  `seen_at` integer NOT NULL,
  PRIMARY KEY (`owner_email`, `period_id`)
);
