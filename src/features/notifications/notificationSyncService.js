import { getUpcomingReminderSchedule } from "./notificationService.js";

export class NotificationSyncValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotificationSyncValidationError";
  }
}

export function createNotificationSyncPayload(todos, calendarEvents, generatedAt = new Date()) {
  if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.valueOf())) {
    throw new TypeError("通知同期の作成日時が正しくありません。");
  }

  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    notifications: getUpcomingReminderSchedule(todos, calendarEvents, generatedAt).map(
      (reminder) => ({
        id: reminder.id,
        scheduledAt: reminder.scheduledAt.toISOString(),
        title: reminder.title,
        body: reminder.labels.join("・"),
        sourceType: reminder.sourceType,
        sourceId: reminder.sourceId,
      }),
    ),
  };
}

export function validateNotificationSyncPayload(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    input.schemaVersion !== 1 ||
    !isIsoTimestamp(input.generatedAt) ||
    !Array.isArray(input.notifications)
  ) {
    throw new NotificationSyncValidationError("通知同期データの形式が正しくありません。");
  }

  const ids = new Set();
  const notifications = input.notifications.map((notification) => {
    if (
      !notification ||
      typeof notification !== "object" ||
      typeof notification.id !== "string" ||
      notification.id.length === 0 ||
      notification.id.length > 512 ||
      ids.has(notification.id) ||
      !isIsoTimestamp(notification.scheduledAt) ||
      typeof notification.title !== "string" ||
      notification.title.length === 0 ||
      notification.title.length > 160 ||
      typeof notification.body !== "string" ||
      notification.body.length > 320 ||
      !["todo", "calendar"].includes(notification.sourceType) ||
      typeof notification.sourceId !== "string" ||
      notification.sourceId.length === 0 ||
      notification.sourceId.length > 160
    ) {
      throw new NotificationSyncValidationError("通知予定の内容が正しくありません。");
    }

    ids.add(notification.id);
    return {
      id: notification.id,
      scheduledAt: notification.scheduledAt,
      title: notification.title,
      body: notification.body,
      sourceType: notification.sourceType,
      sourceId: notification.sourceId,
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    notifications,
  };
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}
