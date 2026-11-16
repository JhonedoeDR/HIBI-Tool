import assert from "node:assert/strict";
import test from "node:test";
import {
  createTodo,
  expandTodoSelection,
  getTodoDescendantIds,
  getTodoChildren,
  getVisibleTodos,
  moveTodoChild,
  pruneExpiredTodos,
  removeTodos,
  setTodoCompletion,
} from "../src/features/todo/todoService.js";
import { createCalendarEvent } from "../src/features/calendar/calendarService.js";
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
    parentId: null,
    childOrder: null,
    childDisplayMode: "all",
    displayGroup: null,
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
  assert.equal(created.parentId, null);
  assert.equal(created.childDisplayMode, "all");
  assert.equal(created.displayGroup, null);
  assert.equal(created.checklist.length, 1);
  assert.equal(created.checklist[0].completed, false);
});

test("supports a parent Todo and expands selected parents to their descendants", () => {
  const todos = [
    todo("parent"),
    todo("child", { parentId: "parent" }),
    todo("grandchild", { parentId: "child" }),
    todo("unrelated"),
  ];

  assert.deepEqual(getTodoDescendantIds(todos, "parent"), ["child", "grandchild"]);
  assert.deepEqual(expandTodoSelection(todos, ["parent"]), [
    "parent",
    "child",
    "grandchild",
  ]);
  assert.deepEqual(expandTodoSelection(todos, ["child"]), ["child", "grandchild"]);

  const child = createTodo(
    {
      title: "Child",
      category: "main",
      startDate: "",
      dueDate: "",
      parentId: "parent",
    },
    { id: "child" },
  );
  assert.equal(child.parentId, "parent");
});

test("rejects invalid or self-referential parent Todo IDs", () => {
  const base = {
    title: "Task",
    category: "main",
    startDate: "",
    dueDate: "",
  };
  assert.throws(
    () => createTodo({ ...base, parentId: 7 }, { id: "task" }),
    /親Todoの指定が正しくありません/,
  );
  assert.throws(
    () => createTodo({ ...base, parentId: "task" }, { id: "task" }),
    /親Todoの指定が正しくありません/,
  );
});

test("deleting a parent detaches surviving child Todos", () => {
  const todos = [todo("parent"), todo("child", { parentId: "parent" })];
  const remaining = removeTodos(todos, ["parent"]);

  assert.deepEqual(remaining.map((item) => item.id), ["child"]);
  assert.equal(remaining[0].parentId, null);
});

test("sequential mode exposes one incomplete child in its saved order", () => {
  const todos = [
    todo("parent", { childDisplayMode: "sequential" }),
    todo("second", { parentId: "parent", childOrder: 1 }),
    todo("first", { parentId: "parent", childOrder: 0 }),
    todo("third", { parentId: "parent", childOrder: 2 }),
  ];
  const visibleChildren = (items) =>
    getVisibleTodos(items, { category: "all", today: "2025-05-01" })
      .filter((item) => item.parentId === "parent")
      .map((item) => item.id);

  assert.deepEqual(visibleChildren(todos), ["first"]);
  const firstCompleted = setTodoCompletion(todos, "first", true, new Date("2025-05-01T08:00:00Z"));
  assert.deepEqual(visibleChildren(firstCompleted), ["second"]);
  const secondCompleted = setTodoCompletion(
    firstCompleted,
    "second",
    true,
    new Date("2025-05-01T08:00:00Z"),
  );
  assert.deepEqual(visibleChildren(secondCompleted), ["third"]);
});

test("custom mode shows one display group at a time and honors child order", () => {
  const todos = [
    todo("parent", { childDisplayMode: "custom" }),
    todo("later", { parentId: "parent", childOrder: 2, displayGroup: 2 }),
    todo("second", { parentId: "parent", childOrder: 1, displayGroup: 1 }),
    todo("first", { parentId: "parent", childOrder: 0, displayGroup: 1 }),
  ];
  const visibleChildren = (items) =>
    getVisibleTodos(items, { category: "all", today: "2025-05-01" })
      .filter((item) => item.parentId === "parent")
      .map((item) => item.id);

  assert.deepEqual(visibleChildren(todos), ["first", "second"]);
  const firstCompleted = setTodoCompletion(todos, "first", true, new Date("2025-05-01T08:00:00Z"));
  assert.deepEqual(visibleChildren(firstCompleted), ["second"]);
  const groupCompleted = setTodoCompletion(
    firstCompleted,
    "second",
    true,
    new Date("2025-05-01T08:00:00Z"),
  );
  assert.deepEqual(visibleChildren(groupCompleted), ["later"]);
});

test("child display order can be changed without moving unrelated Todos", () => {
  const todos = [
    todo("parent"),
    todo("first", { parentId: "parent", childOrder: 0 }),
    todo("unrelated"),
    todo("second", { parentId: "parent", childOrder: 1 }),
  ];
  const moved = moveTodoChild(todos, "second", -1, new Date("2025-05-02T08:00:00Z"));

  assert.deepEqual(getTodoChildren(moved, "parent").map((item) => item.id), ["second", "first"]);
  assert.equal(moved.find((item) => item.id === "unrelated"), todos[2]);
  assert.deepEqual(moveTodoChild(moved, "second", -1), moved);
});

test("all mode shows every child and keeps the configured child order", () => {
  const todos = [
    todo("parent"),
    todo("first", { parentId: "parent", childOrder: 0, dueDate: "2025-05-04" }),
    todo("second", { parentId: "parent", childOrder: 1, dueDate: "2025-05-02" }),
    todo("unrelated", { dueDate: "2025-05-01" }),
  ];

  assert.deepEqual(
    getVisibleTodos(todos, { category: "all", today: "2025-05-01" })
      .filter((item) => item.parentId === "parent")
      .map((item) => item.id),
    ["first", "second"],
  );
});

test("rejects invalid dates, reversed date ranges, and unsafe links", () => {
  const base = { title: "Task", category: "main", startDate: "", dueDate: "", checklist: [], links: [] };
  assert.throws(() => createTodo({ ...base, dueDate: "2025-02-30" }), /日付が正しくありません/);
  assert.throws(
    () => createTodo({ ...base, startDate: "2025-05-02", dueDate: "2025-05-01" }),
    /開始日は期限以前/,
  );
  assert.throws(() => createTodo({ ...base, links: ["javascript:alert(1)"] }), /http または https/);
  assert.throws(
    () => createTodo({ ...base, parentId: "parent", displayGroup: 101 }),
    /表示グループは1〜100/,
  );
  assert.throws(
    () => createTodo({ ...base, childDisplayMode: "invalid" }),
    /子Todoの表示方式/,
  );
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

test("schema migration adds parent links and calendar events inherit child Todo links", () => {
  const storage = memoryStorage();
  const legacyTodo = todo("legacy");
  delete legacyTodo.parentId;
  delete legacyTodo.childOrder;
  delete legacyTodo.childDisplayMode;
  delete legacyTodo.displayGroup;
  const legacyChild = todo("legacy-child", { parentId: "legacy" });
  delete legacyChild.childOrder;
  delete legacyChild.childDisplayMode;
  delete legacyChild.displayGroup;
  storage.setItem(
    APP_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 5,
      todos: [legacyTodo, legacyChild],
      game: createInitialGameState(),
      calendarEvents: [],
    }),
  );
  const migrated = loadAppState(storage, "2025-05-01");
  assert.equal(migrated.todos[0].parentId, null);
  assert.equal(migrated.todos[0].childDisplayMode, "all");
  assert.equal(migrated.todos[0].displayGroup, null);
  assert.equal(migrated.todos[1].childOrder, 0);
  assert.equal(migrated.todos[1].displayGroup, 1);
  assert.equal(JSON.parse(storage.values.get(APP_STORAGE_KEY)).schemaVersion, 6);

  const event = createCalendarEvent(
    {
      type: "deadline",
      title: "Submit",
      date: "2025-05-04",
      dueTime: "17:00",
      notificationOffsets: [],
      todoIds: ["parent"],
    },
    { id: "event-1", now: new Date("2025-05-01T00:00:00.000Z") },
  );
  const saved = saveAppState(
    {
      todos: [todo("parent"), todo("child", { parentId: "parent" })],
      game: createInitialGameState(),
      calendarEvents: [event],
    },
    storage,
  );
  assert.deepEqual(saved.calendarEvents[0].todoIds, ["parent", "child"]);
});

test("repository rejects missing parents and cyclic Todo relationships", () => {
  const storage = memoryStorage();
  const base = { game: createInitialGameState() };
  assert.throws(
    () => saveAppState({ ...base, todos: [todo("child", { parentId: "missing" })] }, storage),
    TodoStorageError,
  );
  assert.throws(
    () =>
      saveAppState(
        {
          ...base,
          todos: [
            todo("first", { parentId: "second" }),
            todo("second", { parentId: "first" }),
          ],
        },
        storage,
      ),
    TodoStorageError,
  );
});
