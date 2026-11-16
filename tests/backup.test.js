import assert from "node:assert/strict";
import test from "node:test";
import { createBackupJson, BackupFormatError, parseBackupJson } from "../src/features/data/backupService.js";
import {
  createInitialGameState,
  loadAppState,
  MAX_AUTOMATIC_BACKUPS,
  saveAppState,
  TodoStorageError,
} from "../src/features/todo/todoRepository.js";
import { createCalendarEvent } from "../src/features/calendar/calendarService.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function todo(id) {
  return {
    id,
    title: id,
    category: "main",
    startDate: null,
    dueDate: null,
    parentId: null,
    checklist: [],
    links: [],
    completed: false,
    completedAt: null,
    createdAt: "2026-11-16T08:00:00.000Z",
    updatedAt: "2026-11-16T08:00:00.000Z",
  };
}

test("JSON backups round-trip all application data without nesting automatic backups", () => {
  const data = {
    todos: [todo("task-1")],
    game: { ...createInitialGameState(), jewels: 120 },
    calendarEvents: [
      createCalendarEvent(
        {
          type: "appointment",
          title: "Doctor",
          date: "2026-11-18",
          startTime: "10:30",
          travelMinutes: 25,
          preparationMinutes: 15,
          arrivalLeadMinutes: 5,
          location: "Clinic",
        },
        { id: "event-1", now: new Date("2026-11-16T08:00:00.000Z") },
      ),
    ],
  };
  const json = createBackupJson(data, new Date("2026-11-16T10:00:00.000Z"));

  assert.deepEqual(parseBackupJson(json), data);
  assert.equal(JSON.parse(json).format, "daily-tool-backup");
  assert.equal(Object.hasOwn(JSON.parse(json).data, "backups"), false);
});

test("JSON restore rejects malformed or unrelated data", () => {
  assert.throws(() => parseBackupJson("{"), BackupFormatError);
  assert.throws(
    () => parseBackupJson(JSON.stringify({ format: "other", version: 1, data: {} })),
    /Daily-toolのJSONバックアップではありません/,
  );
  assert.throws(
    () =>
      parseBackupJson(
        JSON.stringify({
          format: "daily-tool-backup",
          version: 1,
          data: { todos: [], game: { ...createInitialGameState(), jewels: -1 } },
        }),
      ),
    /データ形式が正しくありません/,
  );
});

test("automatic backups keep only the latest ten prior application states", () => {
  const storage = memoryStorage();
  let state = { todos: [], game: createInitialGameState() };
  state = saveAppState(state, storage);

  for (let jewels = 1; jewels <= 12; jewels += 1) {
    state = saveAppState(
      { todos: [todo(`task-${jewels}`)], game: { ...state.game, jewels } },
      storage,
    );
  }

  assert.equal(state.backups.length, MAX_AUTOMATIC_BACKUPS);
  assert.equal(state.backups[0].data.game.jewels, 2);
  assert.equal(state.backups.at(-1).data.game.jewels, 11);
  assert.deepEqual(loadAppState(storage, "2026-11-16").backups, state.backups);
});

test("restoring an automatic backup preserves the replaced state as a new backup", () => {
  const storage = memoryStorage();
  const original = { todos: [todo("original")], game: createInitialGameState() };
  saveAppState(original, storage);
  const changed = {
    todos: [todo("changed")],
    game: { ...original.game, jewels: 50 },
  };
  const afterChange = saveAppState(changed, storage);
  const restored = saveAppState(afterChange.backups[0].data, storage);

  assert.deepEqual(restored.todos, original.todos);
  assert.equal(restored.game.jewels, 0);
  assert.equal(restored.backups.at(-1).data.game.jewels, 50);
});

test("retries a failed storage write once and keeps the previous state if both attempts fail", () => {
  const storage = memoryStorage();
  const original = { todos: [], game: createInitialGameState() };
  saveAppState(original, storage);
  const originalJson = storage.getItem("daily-tool.state.v1");
  let failures = 1;
  const transientStorage = {
    getItem: storage.getItem,
    setItem(key, value) {
      if (failures > 0) {
        failures -= 1;
        throw new Error("temporary storage failure");
      }
      storage.setItem(key, value);
    },
  };

  const changed = saveAppState(
    { todos: [], game: { ...original.game, jewels: 1 } },
    transientStorage,
  );
  assert.equal(changed.game.jewels, 1);
  assert.equal(failures, 0);

  const currentJson = storage.getItem("daily-tool.state.v1");
  const failingStorage = {
    getItem: storage.getItem,
    setItem() {
      throw new Error("persistent storage failure");
    },
  };
  assert.throws(
    () => saveAppState({ todos: [], game: { ...changed.game, jewels: 2 } }, failingStorage),
    TodoStorageError,
  );
  assert.equal(storage.getItem("daily-tool.state.v1"), currentJson);
  assert.notEqual(currentJson, originalJson);
});
