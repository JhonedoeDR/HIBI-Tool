import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceMissedRoutineTodos,
  advanceRoutineTodo,
  getFirstRoutineDate,
  getNextRoutineDate,
  getRoutineLabel,
  normalizeRoutineRule,
} from "../src/features/todo/routineService.js";
import {
  awardTodoCompletion,
} from "../src/features/game/gameService.js";
import { createInitialGameState } from "../src/features/todo/todoRepository.js";
import { setTodoCompletion } from "../src/features/todo/todoService.js";

test("daily, weekly, and custom day intervals retain their calendar cadence", () => {
  assert.equal(
    getNextRoutineDate({ type: "daily", anchorDate: "2025-05-01" }, "2025-05-01"),
    "2025-05-02",
  );
  assert.equal(
    getNextRoutineDate({ type: "weekly", anchorDate: "2025-05-01" }, "2025-05-02"),
    "2025-05-08",
  );
  assert.equal(
    getNextRoutineDate(
      { type: "interval", anchorDate: "2025-05-01", unit: "days", interval: 3 },
      "2025-05-02",
    ),
    "2025-05-04",
  );
  assert.equal(
    getNextRoutineDate({ type: "daily", anchorDate: "0099-12-31" }, "0099-12-31"),
    "0100-01-01",
  );
});

test("monthly dates clamp short months without losing the configured day", () => {
  const rule = { type: "monthly", anchorDate: "2025-01-31", day: 31 };
  assert.equal(getNextRoutineDate(rule, "2025-01-31"), "2025-02-28");
  assert.equal(getNextRoutineDate(rule, "2025-02-28"), "2025-03-31");
  assert.equal(
    getNextRoutineDate(
      { type: "interval", anchorDate: "2025-01-31", unit: "months", interval: 1 },
      "2025-02-28",
    ),
    "2025-03-31",
  );
});

test("first occurrence is the first configured date on or after the schedule anchor", () => {
  assert.equal(
    getFirstRoutineDate({ type: "monthly", anchorDate: "2025-01-16", day: 31 }),
    "2025-01-31",
  );
  assert.equal(
    getFirstRoutineDate({ type: "monthly", anchorDate: "2025-01-31", day: 15 }),
    "2025-02-15",
  );
  assert.equal(
    getFirstRoutineDate({
      type: "interval",
      anchorDate: "2025-01-16",
      unit: "months",
      interval: 2,
    }),
    "2025-01-16",
  );
});

test("monthly and yearly weekday schedules select the requested occurrence", () => {
  assert.equal(
    getNextRoutineDate(
      { type: "monthly-weekday", anchorDate: "2025-01-01", weekday: 5, ordinal: "last" },
      "2025-01-31",
    ),
    "2025-02-28",
  );
  assert.equal(
    getNextRoutineDate(
      { type: "monthly-weekday", anchorDate: "2025-01-01", weekday: 1, ordinal: 5 },
      "2025-01-01",
    ),
    "2025-03-31",
  );
  assert.equal(
    getNextRoutineDate(
      {
        type: "yearly-weekday",
        anchorDate: "2025-01-01",
        month: 11,
        weekday: 4,
        ordinal: 4,
      },
      "2025-01-01",
    ),
    "2025-11-27",
  );
});

test("yearly dates clamp leap days and interval schedules support calendar units", () => {
  const leapDay = { type: "yearly", anchorDate: "2024-02-29", month: 2, day: 29 };
  assert.equal(getNextRoutineDate(leapDay, "2024-02-29"), "2025-02-28");
  assert.equal(getNextRoutineDate(leapDay, "2025-02-28"), "2026-02-28");
  assert.equal(
    getNextRoutineDate(
      { type: "interval", anchorDate: "2024-02-29", unit: "years", interval: 2 },
      "2024-02-29",
    ),
    "2026-02-28",
  );
});

test("routine completion advances to the next date and records the last completion", () => {
  const routine = {
    id: "routine",
    category: "routine",
    routineRule: { type: "daily", anchorDate: "2025-05-01" },
    startDate: "2025-05-01",
    dueDate: "2025-05-01",
    completed: true,
    completedAt: "2025-05-01T12:00:00.000Z",
    checklist: [{ id: "check", text: "Check", completed: true }],
  };
  const unrelated = { id: "other" };
  const advanced = advanceRoutineTodo(
    routine,
    [routine, unrelated],
    new Date("2025-05-01T12:00:00.000Z"),
    new Date("2025-05-01T12:01:00.000Z"),
  );

  assert.equal(advanced[0].completed, false);
  assert.equal(advanced[0].completedAt, null);
  assert.equal(advanced[0].routineLastCompletedAt, "2025-05-01T12:00:00.000Z");
  assert.equal(advanced[0].dueDate, "2025-05-02");
  assert.equal(advanced[0].startDate, "2025-05-02");
  assert.equal(advanced[0].checklist[0].completed, false);
  assert.equal(advanced[1], unrelated);
});

test("each completed routine occurrence awards points once", () => {
  const routine = {
    id: "routine",
    category: "routine",
    routineRule: { type: "daily", anchorDate: "2025-05-01" },
    startDate: null,
    dueDate: "2025-05-01",
    completed: false,
    completedAt: null,
    routineLastCompletedAt: null,
    checklist: [],
    updatedAt: "2025-05-01T00:00:00.000Z",
  };
  const firstCompletedAt = new Date("2025-05-01T12:00:00.000Z");
  const firstOccurrence = setTodoCompletion([routine], routine.id, true, firstCompletedAt)[0];
  const firstGame = awardTodoCompletion(
    createInitialGameState(),
    firstOccurrence,
    firstOccurrence.completedAt,
  );
  const nextOccurrence = advanceRoutineTodo(
    firstOccurrence,
    [firstOccurrence],
    firstCompletedAt,
    firstCompletedAt,
  );
  const secondCompletedAt = new Date("2025-05-02T12:00:00.000Z");
  const secondOccurrence = setTodoCompletion(
    nextOccurrence,
    routine.id,
    true,
    secondCompletedAt,
  )[0];
  const secondGame = awardTodoCompletion(
    firstGame,
    secondOccurrence,
    secondOccurrence.completedAt,
  );

  assert.equal(secondGame.normalPoints, 4);
  assert.equal(secondGame.rewardedEventIds.length, 2);
});

test("missed routine dates skip to the next scheduled date and rule labels are readable", () => {
  const routine = {
    id: "routine",
    category: "routine",
    routineRule: { type: "monthly", anchorDate: "2025-01-31", day: 31 },
    dueDate: "2025-01-31",
    startDate: null,
    completed: false,
    completedAt: null,
    checklist: [],
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
  const refreshed = advanceMissedRoutineTodos(
    [routine],
    "2025-03-01",
    new Date("2025-03-01T12:00:00.000Z"),
  );

  assert.equal(refreshed[0].dueDate, "2025-03-31");
  assert.equal(refreshed[0].updatedAt, "2025-03-01T12:00:00.000Z");
  const daily = advanceMissedRoutineTodos(
    [{
      ...routine,
      routineRule: { type: "daily", anchorDate: "2025-02-01" },
      dueDate: "2025-02-28",
    }],
    "2025-03-01",
  );
  assert.equal(daily[0].dueDate, "2025-03-01");
  assert.equal(getRoutineLabel(routine.routineRule), "毎月31日");
  assert.deepEqual(normalizeRoutineRule({ type: "interval", anchorDate: "2025-01-01" }), null);
});
