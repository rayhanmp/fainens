CREATE TABLE IF NOT EXISTS `recap_story` (
  `owner_email` text NOT NULL,
  `month` text NOT NULL,
  `payload_json` text NOT NULL,
  `generated_at` integer NOT NULL,
  PRIMARY KEY (`owner_email`, `month`)
);
