import { validateNotificationSyncPayload } from "./notificationSyncService.js";

export async function persistNotificationSnapshot(
  database,
  { deviceId, credentialHash, fcmToken, payload, now = new Date() },
) {
  if (
    !database ||
    typeof database.prepare !== "function" ||
    typeof database.batch !== "function"
  ) {
    throw new TypeError("通知データベースが正しくありません。");
  }
  if (
    typeof deviceId !== "string" ||
    deviceId.length === 0 ||
    deviceId.length > 128 ||
    typeof credentialHash !== "string" ||
    credentialHash.length === 0 ||
    credentialHash.length > 128 ||
    typeof fcmToken !== "string" ||
    fcmToken.length === 0 ||
    fcmToken.length > 4096 ||
    !(now instanceof Date) ||
    Number.isNaN(now.valueOf())
  ) {
    throw new TypeError("通知端末の登録情報が正しくありません。");
  }

  const validPayload = validateNotificationSyncPayload(payload);
  const nowMs = now.getTime();
  const statements = [
    database
      .prepare(
        `INSERT INTO notification_devices (
          device_id, credential_hash, fcm_token, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          credential_hash = excluded.credential_hash,
          fcm_token = excluded.fcm_token,
          updated_at_ms = excluded.updated_at_ms`,
      )
      .bind(deviceId, credentialHash, fcmToken, nowMs, nowMs),
    database
      .prepare(
        `DELETE FROM scheduled_notifications
        WHERE device_id = ? AND status = 'pending'`,
      )
      .bind(deviceId),
  ];

  for (const notification of validPayload.notifications) {
    const scheduledAtMs = Date.parse(notification.scheduledAt);
    if (scheduledAtMs <= nowMs) {
      continue;
    }
    statements.push(
      database
        .prepare(
          `INSERT INTO scheduled_notifications (
            device_id, notification_id, scheduled_at_ms, title, body,
            source_type, source_id, status, attempt_count, next_attempt_at_ms,
            created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
          ON CONFLICT(device_id, notification_id) DO NOTHING`,
        )
        .bind(
          deviceId,
          notification.id,
          scheduledAtMs,
          notification.title,
          notification.body,
          notification.sourceType,
          notification.sourceId,
          scheduledAtMs,
          nowMs,
        ),
    );
  }

  return database.batch(statements);
}
