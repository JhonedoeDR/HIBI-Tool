import assert from "node:assert/strict";
import test from "node:test";
import {
  getCalendarReminderSchedule,
  getTodoReminderSchedule,
  getUpcomingReminderSchedule,
} from "../src/features/notifications/notificationService.js";
import { createNotificationSyncPayload } from "../src/features/notifications/notificationSyncService.js";
import {
  NotificationSyncValidationError,
  validateNotificationSyncPayload,
} from "../src/features/notifications/notificationSyncService.js";

test("Todo notifications are scheduled at 8 a.m. on the start and deadline days", () => {
  const reminders = getTodoReminderSchedule(
    {
      id: "todo-1",
      title: "Submit report",
      startDate: "2026-11-18",
      dueDate: "2026-11-20",
      completed: false,
    },
    new Date(2026, 10, 16, 8),
  );

  assert.deepEqual(
    reminders.map((reminder) => [
      reminder.scheduledAt.getDate(),
      reminder.scheduledAt.getHours(),
      reminder.labels,
    ]),
    [
      [18, 8, ["開始日"]],
      [19, 8, ["期限前日"]],
      [20, 8, ["期限当日"]],
    ],
  );
});

test("Todo reminders at the same time are grouped and completed Todos are ignored", () => {
  const reminders = getTodoReminderSchedule(
    {
      id: "todo-1",
      title: "Same-day task",
      startDate: "2026-11-18",
      dueDate: "2026-11-18",
      completed: false,
    },
    new Date(2026, 10, 16, 8),
  );

  assert.deepEqual(reminders[1].labels, ["開始日", "期限当日"]);
  assert.deepEqual(
    getTodoReminderSchedule(
      { id: "todo-2", title: "Done", startDate: "2026-11-18", completed: true },
      new Date(2026, 10, 16, 8),
    ),
    [],
  );
});

test("disabled Todo and calendar events produce no reminders", () => {
  const now = new Date(2026, 10, 16, 8);
  assert.deepEqual(
    getTodoReminderSchedule(
      {
        id: "todo-no-reminder",
        title: "No reminder",
        startDate: "2026-11-18",
        notificationsEnabled: false,
        completed: false,
      },
      now,
    ),
    [],
  );
  assert.deepEqual(
    getCalendarReminderSchedule(
      {
        id: "appointment-no-reminder",
        type: "appointment",
        title: "No reminder",
        date: "2026-11-18",
        startTime: "10:30",
        travelMinutes: 25,
        preparationMinutes: 15,
        arrivalLeadMinutes: 5,
        notificationsEnabled: false,
        completed: false,
      },
      now,
    ),
    [],
  );
});

test("appointment notifications account for preparation, travel, and desired arrival", () => {
  const reminders = getCalendarReminderSchedule(
    {
      id: "appointment-1",
      type: "appointment",
      title: "Appointment",
      date: "2026-11-18",
      startTime: "10:30",
      travelMinutes: 25,
      preparationMinutes: 15,
      arrivalLeadMinutes: 5,
      completed: false,
    },
    new Date(2026, 10, 18, 9),
  );

  assert.deepEqual(
    reminders.map((reminder) => [
      reminder.scheduledAt.getHours(),
      reminder.scheduledAt.getMinutes(),
      reminder.labels,
    ]),
    [
      [9, 45, ["準備開始"]],
      [10, 0, ["出発"]],
      [10, 30, ["予定開始"]],
    ],
  );
});

test("deadline offsets use calendar-day arithmetic and retain the due time", () => {
  const reminders = getCalendarReminderSchedule(
    {
      id: "deadline-1",
      type: "deadline",
      title: "Report",
      date: "2026-11-20",
      dueTime: "17:00",
      notificationOffsets: ["30m", "1h", "3h", "1d", "3d", "7d"],
      completed: false,
    },
    new Date(2026, 10, 10, 8),
  );

  assert.deepEqual(
    reminders.map((reminder) => [
      reminder.scheduledAt.getDate(),
      reminder.scheduledAt.getHours(),
      reminder.scheduledAt.getMinutes(),
      reminder.labels[0],
    ]),
    [
      [13, 17, 0, "1週間前"],
      [17, 17, 0, "3日前"],
      [19, 17, 0, "前日"],
      [20, 14, 0, "3時間前"],
      [20, 16, 0, "1時間前"],
      [20, 16, 30, "30分前"],
    ],
  );
});

test("combined reminder schedules are sorted and exclude past or completed events", () => {
  const upcoming = getUpcomingReminderSchedule(
    [
      {
        id: "todo-1",
        title: "Task",
        startDate: "2026-11-18",
        dueDate: null,
        completed: false,
      },
    ],
    [
      {
        id: "deadline-1",
        type: "deadline",
        title: "Past deadline",
        date: "2026-11-15",
        dueTime: "17:00",
        notificationOffsets: ["1d"],
        completed: false,
      },
      {
        id: "appointment-1",
        type: "appointment",
        title: "Done appointment",
        date: "2026-11-18",
        startTime: "10:30",
        travelMinutes: 0,
        preparationMinutes: 0,
        arrivalLeadMinutes: 0,
        completed: true,
      },
    ],
    new Date(2026, 10, 17, 9),
  );

  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].sourceId, "todo-1");
});

test("notification sync payload is a stable full snapshot with ISO timestamps", () => {
  const generatedAt = new Date(2026, 10, 16, 8);
  const todos = [
    {
      id: "todo-1",
      title: "Submit report",
      startDate: "2026-11-18",
      dueDate: null,
      completed: false,
    },
  ];
  const events = [
    {
      id: "deadline-1",
      type: "deadline",
      title: "Application",
      date: "2026-11-20",
      dueTime: "17:00",
      notificationOffsets: ["1h"],
      completed: false,
    },
  ];
  const payload = createNotificationSyncPayload(todos, events, generatedAt);
  const regeneratedPayload = createNotificationSyncPayload(
    todos,
    events,
    new Date(generatedAt.getTime() + 60_000),
  );

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.generatedAt, generatedAt.toISOString());
  assert.deepEqual(
    payload.notifications.map((notification) => ({
      id: notification.id,
      scheduledAt: notification.scheduledAt,
      title: notification.title,
      body: notification.body,
      sourceType: notification.sourceType,
      sourceId: notification.sourceId,
    })),
    [
      {
        id: `todo:todo-1:${new Date(2026, 10, 18, 8).getTime()}`,
        scheduledAt: new Date(2026, 10, 18, 8).toISOString(),
        title: "Submit report",
        body: "開始日",
        sourceType: "todo",
        sourceId: "todo-1",
      },
      {
        id: `calendar:deadline-1:${new Date(2026, 10, 20, 16).getTime()}`,
        scheduledAt: new Date(2026, 10, 20, 16).toISOString(),
        title: "Application",
        body: "1時間前",
        sourceType: "calendar",
        sourceId: "deadline-1",
      },
    ],
  );
  assert.notEqual(regeneratedPayload.generatedAt, payload.generatedAt);
  assert.deepEqual(
    regeneratedPayload.notifications.map((notification) => notification.id),
    payload.notifications.map((notification) => notification.id),
  );
});

test("notification sync payload rejects an invalid generation time", () => {
  assert.throws(
    () => createNotificationSyncPayload([], [], new Date(Number.NaN)),
    TypeError,
  );
});

test("notification sync payload validation returns only supported fields", () => {
  const payload = {
    schemaVersion: 1,
    generatedAt: "2026-11-16T08:00:00.000Z",
    notifications: [
      {
        id: "todo:todo-1:1794816000000",
        scheduledAt: "2026-11-16T09:00:00.000Z",
        title: "Task",
        body: "開始日",
        sourceType: "todo",
        sourceId: "todo-1",
        unexpected: "discarded",
      },
    ],
  };

  assert.deepEqual(validateNotificationSyncPayload(payload), {
    schemaVersion: 1,
    generatedAt: payload.generatedAt,
    notifications: [
      {
        id: payload.notifications[0].id,
        scheduledAt: payload.notifications[0].scheduledAt,
        title: "Task",
        body: "開始日",
        sourceType: "todo",
        sourceId: "todo-1",
      },
    ],
  });
});

test("notification sync payload validation rejects duplicate IDs and invalid timestamps", () => {
  const validNotification = {
    id: "todo:todo-1:1794816000000",
    scheduledAt: "2026-11-16T09:00:00.000Z",
    title: "Task",
    body: "開始日",
    sourceType: "todo",
    sourceId: "todo-1",
  };
  const payload = {
    schemaVersion: 1,
    generatedAt: "2026-11-16T08:00:00.000Z",
    notifications: [validNotification, { ...validNotification }],
  };

  assert.throws(
    () => validateNotificationSyncPayload(payload),
    NotificationSyncValidationError,
  );
  assert.throws(
    () =>
      validateNotificationSyncPayload({
        ...payload,
        notifications: [{ ...validNotification, scheduledAt: "2026-02-30T09:00:00.000Z" }],
      }),
    NotificationSyncValidationError,
  );
});
