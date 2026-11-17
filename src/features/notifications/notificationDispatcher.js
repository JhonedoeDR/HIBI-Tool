export const MAX_NOTIFICATION_ATTEMPTS = 5;
export const NOTIFICATION_BATCH_SIZE = 20;
export const NOTIFICATION_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const LEASE_DURATION_MS = 2 * 60 * 1000;
const RETRY_BASE_MS = 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const NOTIFICATION_CLEANUP_BATCH_SIZE = 500;

export async function dispatchDueNotifications(database, sendNotification, now = Date.now()) {
  if (
    !database ||
    typeof database.prepare !== "function" ||
    typeof database.batch !== "function" ||
    typeof sendNotification !== "function" ||
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    throw new TypeError("通知配信の設定が正しくありません。");
  }

  const jobs = await claimDueNotifications(database, now);
  const result = { claimed: jobs.length, sent: 0, retried: 0, failed: 0 };

  for (const job of jobs) {
    try {
      await sendNotification(job);
      await markNotificationSent(database, job, now);
      result.sent += 1;
    } catch (error) {
      if (!(error instanceof PushDeliveryError)) {
        throw error;
      }

      if (error.invalidToken) {
        await markInvalidToken(database, job, error.code, now);
        result.failed += 1;
      } else if (error.retryable && job.attempt_count < MAX_NOTIFICATION_ATTEMPTS) {
        await scheduleNotificationRetry(database, job, error.code, now);
        result.retried += 1;
      } else {
        await markNotificationFailed(database, job, error.code);
        result.failed += 1;
      }
    }
  }

  return result;
}

export async function pruneExpiredNotificationHistory(database, now = Date.now()) {
  if (
    !database ||
    typeof database.prepare !== "function" ||
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    throw new TypeError("通知履歴の整理設定が正しくありません。");
  }

  const result = await database
    .prepare(
      `DELETE FROM scheduled_notifications
      WHERE rowid IN (
        SELECT rowid
        FROM scheduled_notifications
        WHERE status IN ('sent', 'failed', 'cancelled')
          AND scheduled_at_ms <= ?
        ORDER BY scheduled_at_ms
        LIMIT ?
      )`,
    )
    .bind(now - NOTIFICATION_HISTORY_RETENTION_MS, NOTIFICATION_CLEANUP_BATCH_SIZE)
    .run();
  if (!Number.isSafeInteger(result?.meta?.changes) || result.meta.changes < 0) {
    throw new Error("通知履歴の整理結果を確認できませんでした。");
  }
  return result.meta.changes;
}

export class PushDeliveryError extends Error {
  constructor(code, { retryable = false, invalidToken = false } = {}) {
    super(`Push delivery failed: ${code}`);
    this.name = "PushDeliveryError";
    this.code = code;
    this.retryable = retryable;
    this.invalidToken = invalidToken;
  }
}

async function claimDueNotifications(database, now) {
  const statements = [
    database
      .prepare(
        `UPDATE scheduled_notifications
        SET status = 'failed', lease_until_ms = NULL, last_error_code = 'retry_exhausted'
        WHERE attempt_count >= ?
          AND (
            (status = 'pending' AND scheduled_at_ms <= ? AND next_attempt_at_ms <= ?)
            OR (status = 'sending' AND lease_until_ms <= ?)
          )`,
      )
      .bind(MAX_NOTIFICATION_ATTEMPTS, now, now, now),
    database
      .prepare(
        `UPDATE scheduled_notifications
        SET status = 'sending', attempt_count = attempt_count + 1,
            lease_until_ms = ?, last_error_code = NULL
        WHERE rowid IN (
          SELECT rowid
          FROM scheduled_notifications
          WHERE attempt_count < ?
            AND (
              (status = 'pending' AND scheduled_at_ms <= ? AND next_attempt_at_ms <= ?)
              OR (status = 'sending' AND lease_until_ms <= ?)
            )
          ORDER BY scheduled_at_ms
          LIMIT ?
        )
        RETURNING device_id, notification_id, scheduled_at_ms, title, body,
                  source_type, source_id, attempt_count`,
      )
      .bind(
        now + LEASE_DURATION_MS,
        MAX_NOTIFICATION_ATTEMPTS,
        now,
        now,
        now,
        NOTIFICATION_BATCH_SIZE,
      ),
  ];
  const results = await database.batch(statements);
  const claimed = results?.[1]?.results;
  if (!Array.isArray(claimed)) {
    throw new Error("通知配信対象をデータベースから取得できませんでした。");
  }
  if (claimed.length === 0) {
    return [];
  }

  const claimedFilter = claimed
    .map(() => "(scheduled.device_id = ? AND scheduled.notification_id = ?)")
    .join(" OR ");
  const bindings = claimed.flatMap((job) => [job.device_id, job.notification_id]);
  const selected = await database
    .prepare(
      `SELECT scheduled.device_id, scheduled.notification_id, scheduled.scheduled_at_ms,
              scheduled.title, scheduled.body, scheduled.source_type, scheduled.source_id,
              scheduled.attempt_count, devices.fcm_token
      FROM scheduled_notifications AS scheduled
      JOIN notification_devices AS devices USING (device_id)
      WHERE scheduled.status = 'sending' AND scheduled.lease_until_ms = ?
        AND (${claimedFilter})`,
    )
    .bind(now + LEASE_DURATION_MS, ...bindings)
    .all();
  if (!Array.isArray(selected?.results) || selected.results.length !== claimed.length) {
    throw new Error("通知端末情報を配信キューから取得できませんでした。");
  }
  return selected.results;
}

async function markNotificationSent(database, job, now) {
  await database
    .prepare(
      `UPDATE scheduled_notifications
      SET status = 'sent', sent_at_ms = ?, lease_until_ms = NULL, last_error_code = NULL
      WHERE device_id = ? AND notification_id = ?
        AND status = 'sending' AND attempt_count = ?`,
    )
    .bind(now, job.device_id, job.notification_id, job.attempt_count)
    .run();
}

async function scheduleNotificationRetry(database, job, errorCode, now) {
  const delayMs = Math.min(
    RETRY_BASE_MS * 2 ** (job.attempt_count - 1),
    RETRY_MAX_MS,
  );
  await database
    .prepare(
      `UPDATE scheduled_notifications
      SET status = 'pending', next_attempt_at_ms = ?, lease_until_ms = NULL,
          last_error_code = ?
      WHERE device_id = ? AND notification_id = ?
        AND status = 'sending' AND attempt_count = ?`,
    )
    .bind(
      now + delayMs,
      errorCode,
      job.device_id,
      job.notification_id,
      job.attempt_count,
    )
    .run();
}

async function markNotificationFailed(database, job, errorCode) {
  await database
    .prepare(
      `UPDATE scheduled_notifications
      SET status = 'failed', lease_until_ms = NULL, last_error_code = ?
      WHERE device_id = ? AND notification_id = ?
        AND status = 'sending' AND attempt_count = ?`,
    )
    .bind(errorCode, job.device_id, job.notification_id, job.attempt_count)
    .run();
}

async function markInvalidToken(database, job, errorCode, now) {
  await database.batch([
    database
      .prepare(
        `UPDATE scheduled_notifications
        SET status = CASE
              WHEN EXISTS (
                SELECT 1 FROM notification_devices
                WHERE device_id = ? AND fcm_token = ?
              ) THEN 'failed'
              ELSE 'pending'
            END,
            next_attempt_at_ms = CASE
              WHEN EXISTS (
                SELECT 1 FROM notification_devices
                WHERE device_id = ? AND fcm_token = ?
              ) THEN next_attempt_at_ms
              ELSE ?
            END,
            lease_until_ms = NULL, last_error_code = ?
        WHERE device_id = ? AND notification_id = ?
          AND status = 'sending' AND attempt_count = ?`,
      )
      .bind(
        job.device_id,
        job.fcm_token,
        job.device_id,
        job.fcm_token,
        now,
        errorCode,
        job.device_id,
        job.notification_id,
        job.attempt_count,
      ),
    database
      .prepare(
        `DELETE FROM notification_devices
        WHERE device_id = ? AND fcm_token = ?`,
      )
      .bind(job.device_id, job.fcm_token),
  ]);
}
