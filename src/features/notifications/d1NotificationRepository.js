import { validateNotificationSyncPayload } from "./notificationSyncService.js";

export async function persistNotificationSnapshot(
  database,
  { deviceId, fcmToken, payload, now = new Date() },
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
          device_id, fcm_token, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          fcm_token = excluded.fcm_token,
          updated_at_ms = excluded.updated_at_ms`,
      )
      .bind(deviceId, fcmToken, nowMs, nowMs),
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

export async function consumeNotificationSyncQuota(
  database,
  { deviceId, fcmToken, now = new Date() },
) {
  if (
    !database ||
    typeof database.prepare !== "function" ||
    typeof deviceId !== "string" ||
    deviceId.length === 0 ||
    deviceId.length > 128 ||
    typeof fcmToken !== "string" ||
    fcmToken.length === 0 ||
    fcmToken.length > 4096 ||
    !(now instanceof Date) ||
    Number.isNaN(now.valueOf())
  ) {
    throw new TypeError("通知同期の登録情報が正しくありません。");
  }

  const nowMs = now.getTime();
  const windowStartMs = Math.floor(nowMs / 60_000) * 60_000;
  const result = await database
    .prepare(
      `INSERT INTO notification_devices (
        device_id, fcm_token, created_at_ms, updated_at_ms, sync_window_ms, sync_count
      ) VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(device_id) DO UPDATE SET
        fcm_token = excluded.fcm_token,
        updated_at_ms = excluded.updated_at_ms,
        sync_count = CASE
          WHEN notification_devices.sync_window_ms = excluded.sync_window_ms
            THEN notification_devices.sync_count + 1
          ELSE 1
        END,
        sync_window_ms = excluded.sync_window_ms
      WHERE notification_devices.sync_window_ms != excluded.sync_window_ms
         OR notification_devices.sync_count < 30
      RETURNING sync_count`,
    )
    .bind(deviceId, fcmToken, nowMs, nowMs, windowStartMs)
    .all();

  if (!Array.isArray(result?.results)) {
    throw new Error("通知同期の利用回数を確認できませんでした。");
  }
  return result.results.length === 1;
}
