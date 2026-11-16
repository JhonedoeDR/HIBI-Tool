import assert from "node:assert/strict";
import test from "node:test";
import {
  getCalendarReminderSchedule,
  getTodoReminderSchedule,
  getUpcomingReminderSchedule,
} from "../src/features/notifications/notificationService.js";

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
