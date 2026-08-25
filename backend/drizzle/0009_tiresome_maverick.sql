ALTER TABLE `salary_period` ADD `status` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_period` ADD `closed_at` integer;--> statement-breakpoint
ALTER TABLE `salary_period` ADD `reopened_at` integer;--> statement-breakpoint
-- Enforce the close at the data boundary as well as in HTTP handlers. This
-- catches every posting path, including imports and domain workflows that use
-- direct SQLite inserts.
CREATE TRIGGER `prevent_closed_period_transaction_insert`
BEFORE INSERT ON `transaction`
WHEN EXISTS (
  SELECT 1 FROM `salary_period` AS p
  WHERE p.`status` = 'closed'
    AND (
      p.`id` = NEW.`period_id`
      OR (
        NEW.`date` >= p.`start_date`
        AND NEW.`date` <= CASE
          WHEN p.`end_date` % 86400000 = 0 THEN p.`end_date` + 86399999
          ELSE p.`end_date`
        END
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Cannot post a journal into a closed period');
END;--> statement-breakpoint
CREATE TRIGGER `prevent_closed_period_transaction_reassign`
BEFORE UPDATE OF `date`, `period_id` ON `transaction`
WHEN EXISTS (
  SELECT 1 FROM `salary_period` AS p
  WHERE p.`status` = 'closed'
    AND (
      p.`id` = NEW.`period_id`
      OR (
        NEW.`date` >= p.`start_date`
        AND NEW.`date` <= CASE
          WHEN p.`end_date` % 86400000 = 0 THEN p.`end_date` + 86399999
          ELSE p.`end_date`
        END
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Cannot move a journal into a closed period');
END;
