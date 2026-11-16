import assert from "node:assert/strict";
import test from "node:test";
import { createTodo, getVisibleTodos, pruneExpiredTodos, setTodoCompletion } from "../src/features/todo/todoService.js";
import {
  APP_STORAGE_KEY,
  createInitialGameState,
  loadAppState,
  saveAppState,
  TodoStorageError,
  TODO_STORAGE_KEY,
} from "../src/features/todo/todoRepository.js";

function todo(id, values = {}) {
  return {
    id,
    title: id,
    category: "main",
    startDate: null,
    dueDate: null,
    checklist: [],
    links: [],
    completed: false,
    completedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...values,
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values,
  };
}

test("creates a Todo with normalized optional dates and checklist", () => {
  const created = createTodo(
    {
      title: "  Read  ",
      category: "main",
      startDate: "",
      dueDate: "2025-05-04",
      checklist: ["One", ""],
      links: [],
    },
    { id: "todo-1", now: new Date("2025-05-01T00:00:00.000Z") },
  );

  assert.equal(created.title, "Read");
  assert.equal(created.startDate, null);
  assert.equal(created.dueDate, "2025-05-04");
  assert.equal(created.checklist.length, 1);
  assert.equal(created.checklist[0].completed, false);
});

test("rejects invalid dates, reversed date ranges, and unsafe links", () => {
  const base = { title: "Task", category: "main", startDate: "", dueDate: "", checklist: [], links: [] };
  assert.throws(() => createTodo({ ...base, dueDate: "2025-02-30" }), /日付が正しくありません/);
  assert.throws(
    () => createTodo({ ...base, startDate: "2025-05-02", dueDate: "2025-05-01" }),
    /開始日は期限以前/,
  );
  assert.throws(() => createTodo({ ...base, links: ["javascript:alert(1)"] }), /http または https/);
});

test("filters overdue todos, sorts undated tasks last, and puts not-yet-started tasks last", () => {
  const todos = [
    todo("no-due"),
    todo("later", { dueDate: "2025-05-04" }),
    todo("early", { dueDate: "2025-05-02" }),
    todo("starts-later", { dueDate: "2025-05-03", startDate: "2025-05-04" }),
    todo("expired", { dueDate: "2025-04-30" }),
  ];

  assert.deepEqual(
    getVisibleTodos(todos, { category: "all", sort: "due", today: "2025-05-02" }).map((item) => item.id),
    ["early", "later", "no-due", "starts-later"],
  );
});

test("prunes only after the seven-day retention period", () => {
  const todos = [
    todo("keep", { dueDate: "2025-05-01" }),
    todo("remove", { dueDate: "2025-04-30" }),
    todo("no-due"),
  ];

  assert.deepEqual(
    pruneExpiredTodos(todos, "2025-05-08").map((item) => item.id),
    ["keep", "no-due"],
  );
});

test("completion updates are idempotent and preserve unrelated todos", () => {
  const first = todo("first");
  const second = todo("second");
  const completed = setTodoCompletion([first, second], "first", true, new Date("2025-05-01T08:00:00Z"));
  const repeated = setTodoCompletion(completed, "first", true, new Date("2025-05-02T08:00:00Z"));

  assert.equal(repeated[0].completedAt, "2025-05-01T08:00:00.000Z");
  assert.equal(repeated[1], second);
});

test("repository prunes expired records and refuses to overwrite malformed data", () => {
  const storage = memoryStorage();
  saveAppState(
    {
      todos: [todo("expired", { dueDate: "2025-04-30" }), todo("current")],
      game: createInitialGameState(),
    },
    storage,
  );
  assert.deepEqual(loadAppState(storage, "2025-05-08").todos.map((item) => item.id), ["current"]);
  assert.deepEqual(
    JSON.parse(storage.values.get(APP_STORAGE_KEY)).todos.map((item) => item.id),
    ["current"],
  );

  storage.setItem(APP_STORAGE_KEY, "{invalid");
  assert.throws(() => loadAppState(storage, "2025-05-08"), TodoStorageError);
  assert.equal(storage.values.get(APP_STORAGE_KEY), "{invalid");
});

test("repository migrates legacy Todo data without deleting its original copy", () => {
  const legacyTodos = [todo("legacy")];
  const storage = memoryStorage({ [TODO_STORAGE_KEY]: JSON.stringify(legacyTodos) });

  const state = loadAppState(storage, "2025-05-08");

  assert.deepEqual(state.todos, legacyTodos);
  assert.equal(state.game.normalPoints, 0);
  assert.equal(storage.values.get(TODO_STORAGE_KEY), JSON.stringify(legacyTodos));
  assert.deepEqual(JSON.parse(storage.values.get(APP_STORAGE_KEY)).todos, legacyTodos);
});
