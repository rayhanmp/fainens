CREATE TRIGGER IF NOT EXISTS `cache_invalidation_on_revision`
AFTER UPDATE OF `revision` ON `financial_state`
WHEN NEW.`revision` <> OLD.`revision`
BEGIN
  INSERT INTO `cache_invalidation_outbox` (`operation`, `revision`, `status`, `attempts`)
  VALUES ('all', NEW.`revision`, 'pending', 0);
END;
