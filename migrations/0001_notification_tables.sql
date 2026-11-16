CREATE TABLE IF NOT EXISTS notification_devices (
  device_id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL,
  fcm_token TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS scheduled_notifications (
  device_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  scheduled_at_ms INTEGER NOT NULL CHECK (scheduled_at_ms >= 0),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body TEXT NOT NULL CHECK (length(body) <= 320),
  source_type TEXT NOT NULL CHECK (source_type IN ('todo', 'calendar')),
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at_ms INTEGER NOT NULL CHECK (next_attempt_at_ms >= 0),
  lease_until_ms INTEGER,
  sent_at_ms INTEGER,
  last_error_code TEXT,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (device_id, notification_id),
  FOREIGN KEY (device_id) REFERENCES notification_devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS scheduled_notifications_due_idx
  ON scheduled_notifications(status, scheduled_at_ms, next_attempt_at_ms);

CREATE INDEX IF NOT EXISTS scheduled_notifications_device_idx
  ON scheduled_notifications(device_id, status, scheduled_at_ms);
