ALTER TABLE notification_devices DROP COLUMN credential_hash;

ALTER TABLE notification_devices
  ADD COLUMN sync_window_ms INTEGER NOT NULL DEFAULT 0 CHECK (sync_window_ms >= 0);

ALTER TABLE notification_devices
  ADD COLUMN sync_count INTEGER NOT NULL DEFAULT 0 CHECK (sync_count BETWEEN 0 AND 30);
