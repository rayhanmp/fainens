CREATE TABLE IF NOT EXISTS `recap_period_story` (
  `owner_email` text NOT NULL,
  `period_id` integer NOT NULL,
  `payload_json` text NOT NULL,
  `generated_at` integer NOT NULL,
  PRIMARY KEY (`owner_email`, `period_id`)
);
