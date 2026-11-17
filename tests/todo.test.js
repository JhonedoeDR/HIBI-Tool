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
    routineRule: null,
    routineLastCompletedAt: null,
    notificationsEnabled: true,
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
  assert.equal(created.notificationsEnabled, true);
  assert.equal(created.parentId, null);
  assert.equal(created.childDisplayMode, "all");
  assert.equal(created.displayGroup, null);
  assert.equal(created.checklist.length, 1);
  assert.equal(created.checklist[0].completed, false);
});

test("supports disabling notifications on an individual Todo", () => {
  const created = createTodo({
    title: "No reminder",
    category: "main",
    startDate: "",
    dueDate: "2025-05-04",
    notificationsEnabled: false,
  });

  assert.equal(created.notificationsEnabled, false);
  assert.throws(
    () =>
      createTodo({
        title: "Invalid reminder",
        category: "main",
        startDate: "",
        dueDate: "",
        notificationsEnabled: "false",
      }),
    /通知設定が正しくありません/,
  );
});

test("creates a routine with a normalized recurrence and default scheduled date", () => {
  const routine = createTodo(
    {
      title: "Drink water",
      category: "routine",
      startDate: "",
      dueDate: "",
      checklist: [],
      links: [],
      routineRule: {
        type: "monthly",
        anchorDate: "2025-01-16",
        day: "31",
      },
    },
    { id: "routine-1", now: new Date("2025-01-01T00:00:00.000Z") },
  );

  assert.equal(routine.dueDate, "2025-01-31");
  assert.deepEqual(routine.routineRule, {
    type: "monthly",
    anchorDate: "2025-01-16",
    day: 31,
  });
  assert.equal(routine.routineLastCompletedAt, null);
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

test("legacy routine Todos migrate to the current scheduled date", () => {
  const legacyRoutine = todo("legacy-routine", {
    category: "routine",
    createdAt: "2026-11-15T00:00:00.000Z",
  });
  delete legacyRoutine.routineRule;
  delete legacyRoutine.routineLastCompletedAt;
  const legacyTodos = [legacyRoutine];
  const storage = memoryStorage({ [TODO_STORAGE_KEY]: JSON.stringify(legacyTodos) });

  const state = loadAppState(storage, "2026-11-16");

  assert.equal(state.todos[0].routineRule.type, "daily");
  assert.equal(state.todos[0].dueDate, "2026-11-16");
  assert.equal(storage.values.get(TODO_STORAGE_KEY), JSON.stringify(legacyTodos));
});

test("schema migration adds parent links and calendar events inherit child Todo links", () => {
  const storage = memoryStorage();
  const legacyTodo = todo("legacy");
  delete legacyTodo.parentId;
  delete legacyTodo.childOrder;
  delete legacyTodo.childDisplayMode;
  delete legacyTodo.displayGroup;
  delete legacyTodo.routineRule;
  delete legacyTodo.routineLastCompletedAt;
  delete legacyTodo.notificationsEnabled;
  const legacyChild = todo("legacy-child", { parentId: "legacy" });
  delete legacyChild.childOrder;
  delete legacyChild.childDisplayMode;
  delete legacyChild.displayGroup;
  delete legacyChild.routineRule;
  delete legacyChild.routineLastCompletedAt;
  delete legacyChild.notificationsEnabled;
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
  assert.equal(migrated.todos[0].notificationsEnabled, true);
  assert.equal(migrated.todos[1].childOrder, 0);
  assert.equal(migrated.todos[1].displayGroup, 1);
  assert.equal(JSON.parse(storage.values.get(APP_STORAGE_KEY)).schemaVersion, 8);

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
      calendarEvents: [{ ...event, notificationsEnabled: undefined }],
    },
    storage,
  );
  assert.deepEqual(saved.calendarEvents[0].todoIds, ["parent", "child"]);
  assert.equal(saved.calendarEvents[0].notificationsEnabled, true);
});

test("schema v6 gives legacy routine Todos a daily rule and advances missed dates", () => {
  const storage = memoryStorage();
  const legacyRoutine = todo("legacy-routine", {
    category: "routine",
    dueDate: "2026-11-15",
  });
  delete legacyRoutine.routineRule;
  delete legacyRoutine.routineLastCompletedAt;
  storage.setItem(
    APP_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 6,
      todos: [legacyRoutine],
      game: createInitialGameState(),
      calendarEvents: [],
    }),
  );

  const migrated = loadAppState(storage, "2026-11-16");

  assert.deepEqual(migrated.todos[0].routineRule, {
    type: "daily",
    anchorDate: "2026-11-15",
  });
  assert.equal(migrated.todos[0].dueDate, "2026-11-16");
  assert.equal(JSON.parse(storage.values.get(APP_STORAGE_KEY)).schemaVersion, 8);
});

test("schema v7 data keeps existing reminders enabled during migration", () => {
  const legacyTodo = todo("legacy-notification");
  delete legacyTodo.notificationsEnabled;
  const legacyEvent = createCalendarEvent({
    type: "deadline",
    title: "Existing deadline",
    date: "2026-11-18",
    dueTime: "17:00",
    notificationOffsets: ["1h"],
  });
  delete legacyEvent.notificationsEnabled;
  const storage = memoryStorage({
    [APP_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 7,
      todos: [legacyTodo],
      game: createInitialGameState(),
      calendarEvents: [legacyEvent],
    }),
  });

  const migrated = loadAppState(storage, "2026-11-16");

  assert.equal(migrated.todos[0].notificationsEnabled, true);
  assert.equal(migrated.calendarEvents[0].notificationsEnabled, true);
  assert.equal(JSON.parse(storage.values.get(APP_STORAGE_KEY)).schemaVersion, 8);
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
