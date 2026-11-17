import assert from "node:assert/strict";
import test from "node:test";
import {
  GoogleCalendarMappingError,
  mapCalendarEventToGoogleCalendarEvent,
} from "../src/features/calendar/googleCalendarMapper.js";

test("maps appointments with stable IDs, duration, location, and source metadata", async () => {
  const appointment = {
    id: "local-appointment",
    type: "appointment",
    title: "Dentist",
    date: "2026-11-18",
    startTime: "10:30",
    durationMinutes: 90,
    travelMinutes: 20,
    preparationMinutes: 15,
    arrivalLeadMinutes: 5,
    location: "Clinic",
  };

  const mapped = await mapCalendarEventToGoogleCalendarEvent(appointment, {
    timeZone: "UTC",
  });
  const mappedAgain = await mapCalendarEventToGoogleCalendarEvent(appointment, {
    timeZone: "UTC",
  });

  assert.match(mapped.id, /^d[0-9a-f]{64}$/);
  assert.equal(mapped.id, mappedAgain.id);
  assert.equal(mapped.summary, "Dentist");
  assert.equal(mapped.start.dateTime, "2026-11-18T10:30:00.000Z");
  assert.equal(mapped.end.dateTime, "2026-11-18T12:00:00.000Z");
  assert.equal(mapped.start.timeZone, "UTC");
  assert.equal(mapped.location, "Clinic");
  assert.match(mapped.description, /移動時間: 20分/);
  assert.equal(mapped.extendedProperties.private.dailyToolEventId, "local-appointment");
});

test("maps deadlines as timed events with an unspecified end time", async () => {
  const mapped = await mapCalendarEventToGoogleCalendarEvent(
    {
      id: "local-deadline",
      type: "deadline",
      title: "Submit report",
      date: "2026-11-20",
      dueTime: "17:00",
    },
    { timeZone: "UTC" },
  );

  assert.equal(mapped.start.dateTime, "2026-11-20T17:00:00.000Z");
  assert.equal(mapped.end.dateTime, mapped.start.dateTime);
  assert.equal(mapped.endTimeUnspecified, true);
});

test("converts local event time in the selected zone and rejects nonexistent times", async () => {
  const tokyoEvent = await mapCalendarEventToGoogleCalendarEvent(
    {
      id: "tokyo-event",
      type: "deadline",
      title: "Tokyo deadline",
      date: "2026-11-20",
      dueTime: "17:00",
    },
    { timeZone: "Asia/Tokyo" },
  );
  assert.equal(tokyoEvent.start.dateTime, "2026-11-20T08:00:00.000Z");

  await assert.rejects(
    mapCalendarEventToGoogleCalendarEvent(
      {
        id: "dst-event",
        type: "deadline",
        title: "Nonexistent local time",
        date: "2026-03-08",
        dueTime: "02:30",
      },
      { timeZone: "America/Los_Angeles" },
    ),
    GoogleCalendarMappingError,
  );
});

test("rejects malformed or unmappable calendar events", async () => {
  await assert.rejects(
    mapCalendarEventToGoogleCalendarEvent({ id: "bad", type: "appointment" }),
    GoogleCalendarMappingError,
  );
  await assert.rejects(
    mapCalendarEventToGoogleCalendarEvent({
      id: "missing-duration",
      type: "appointment",
      title: "Meeting",
      date: "2026-11-18",
      startTime: "10:30",
    }),
    GoogleCalendarMappingError,
  );
  await assert.rejects(
    mapCalendarEventToGoogleCalendarEvent({
      id: "invalid-date",
      type: "deadline",
      title: "Invalid date",
      date: "2026-02-31",
      dueTime: "17:00",
    }),
    GoogleCalendarMappingError,
  );
});
