import assert from "node:assert/strict";
import test from "node:test";
import {
  CalendarValidationError,
  createCalendarEvent,
  getCalendarDays,
  setCalendarCompletion,
  shiftMonth,
} from "../src/features/calendar/calendarService.js";

test("creates appointment and deadline records with normalized values", () => {
  const appointment = createCalendarEvent(
    {
      type: "appointment",
      title: "  Dentist ",
      date: "2026-11-18",
      startTime: "10:30",
      travelMinutes: "25",
      preparationMinutes: "15",
      arrivalLeadMinutes: "5",
      location: " Clinic ",
    },
    { id: "appointment-1", now: new Date("2026-11-16T08:00:00.000Z") },
  );
  const deadline = createCalendarEvent(
    {
      type: "deadline",
      title: "Report",
      date: "2026-11-20",
      dueTime: "17:00",
      notificationOffsets: ["1d", "30m", "1d"],
    },
    { id: "deadline-1", now: new Date("2026-11-16T08:00:00.000Z") },
  );

  assert.equal(appointment.title, "Dentist");
  assert.equal(appointment.travelMinutes, 25);
  assert.equal(appointment.location, "Clinic");
  assert.deepEqual(deadline.notificationOffsets, ["1d", "30m"]);
  assert.equal(deadline.completed, false);
  assert.equal(deadline.completedAt, null);
});

test("rejects malformed calendar dates, times, durations, and reminders", () => {
  const validAppointment = {
    type: "appointment",
    title: "Checkup",
    date: "2026-11-18",
    startTime: "10:30",
    travelMinutes: "25",
    preparationMinutes: "15",
    arrivalLeadMinutes: "5",
    location: "",
  };
  assert.throws(
    () => createCalendarEvent(null),
    CalendarValidationError,
  );
  assert.throws(
    () => createCalendarEvent({ ...validAppointment, title: "" }),
    CalendarValidationError,
  );
  assert.throws(
    () => createCalendarEvent({ ...validAppointment, date: "2026-02-30" }),
    CalendarValidationError,
  );
  assert.throws(
    () => createCalendarEvent({ ...validAppointment, startTime: "25:00" }),
    CalendarValidationError,
  );
  assert.throws(
    () => createCalendarEvent({ ...validAppointment, travelMinutes: "-1" }),
    CalendarValidationError,
  );
  assert.throws(
    () =>
      createCalendarEvent({
        type: "deadline",
        title: "Submit",
        date: "2026-11-18",
        dueTime: "17:00",
        notificationOffsets: ["2h"],
      }),
    CalendarValidationError,
  );
});

test("builds Sunday-first month cells and shifts across year boundaries", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2027-01", -1), "2026-12");

  const days = getCalendarDays("2024-02", "2024-02-29");
  assert.equal(days[0].date, "2024-01-28");
  assert.equal(days[0].inMonth, false);
  assert.equal(days[4].date, "2024-02-01");
  assert.equal(days[32].date, "2024-02-29");
  assert.equal(days[32].isToday, true);
  assert.equal(days.length, 35);
});

test("completion can be toggled and records the completion timestamp", () => {
  const original = {
    id: "event-1",
    completed: false,
    completedAt: null,
    updatedAt: "2026-11-16T08:00:00.000Z",
  };
  const completedAt = new Date("2026-11-16T09:00:00.000Z");
  const completed = setCalendarCompletion([original], "event-1", true, completedAt);

  assert.equal(completed[0].completed, true);
  assert.equal(completed[0].completedAt, completedAt.toISOString());
  assert.equal(original.completed, false);
  assert.equal(
    setCalendarCompletion(completed, "event-1", true, new Date())[0],
    completed[0],
  );
});
