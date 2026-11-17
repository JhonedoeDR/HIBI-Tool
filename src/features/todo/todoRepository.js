import { getLocalDateKey, pruneExpiredTodos } from "./todoService.js";
import {
  advanceMissedRoutineTodos,
  createDefaultRoutineRule,
  isRoutineRule,
} from "./routineService.js";

export const APP_STORAGE_KEY = "daily-tool.state.v1";
export const TODO_STORAGE_KEY = "daily-tool.todos.v1";
export const MAX_AUTOMATIC_BACKUPS = 10;
const APP_SCHEMA_VERSION = 8;

export class TodoStorageError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "TodoStorageError";
  }
}

export function createInitialGameState() {
  return {
    normalPoints: 0,
    attackPoints: 0,
    jewels: 0,
    rewardedEventIds: [],
    area: 1,
    position: 0,
    loginBonus: {
      nextDay: 1,
      lastClaimDate: null,
      lastClaimedDay: null,
    },
  };
}

export function loadAppState(storage, today = getLocalDateKey()) {
  storage ??= getDefaultStorage();
  assertStorage(storage);

  const raw = readStorage(storage, APP_STORAGE_KEY);
  if (raw !== null) {
    const parsedState = parseAppState(raw);
    const { schemaVersion, ...state } = parsedState;
    const refreshedTodos = advanceRoutineDates(state.todos, today);
    const todos = pruneExpiredTodos(refreshedTodos, today);
    const updatedState = { ...state, todos };
    if (
      schemaVersion !== APP_SCHEMA_VERSION ||
      refreshedTodos !== state.todos ||
      todos.length !== refreshedTodos.length
    ) {
      return saveAppState(updatedState, storage);
    }
    return updatedState;
  }

  const legacyTodos = readStorage(storage, TODO_STORAGE_KEY);
  if (legacyTodos === null) {
    return { todos: [], game: createInitialGameState(), calendarEvents: [], backups: [] };
  }

  let todos;
  try {
    todos = JSON.parse(legacyTodos);
  } catch (cause) {
    throw new TodoStorageError("Todoデータを解析できません。データは変更していません。", {
      cause,
    });
  }
  if (!Array.isArray(todos) || !todos.every(isTodoRecord)) {
    throw new TodoStorageError("Todoデータの形式が正しくありません。データは変更していません。");
  }

  const normalized = normalizeAppData({
    todos,
    game: createInitialGameState(),
    calendarEvents: [],
  });
  if (!normalized) {
    throw new TodoStorageError("Todoデータを新しい形式に変換できません。データは変更していません。");
  }
  const refreshedTodos = advanceRoutineDates(normalized.todos, today);
  const state = {
    ...normalized,
    todos: pruneExpiredTodos(refreshedTodos, today),
  };
  return saveAppState(state, storage, { createBackup: false });
}

export function saveAppState(state, storage, { createBackup = true } = {}) {
  storage ??= getDefaultStorage();
  assertStorage(storage);
  const data = normalizeAppData(state);
  if (!data) {
    throw new TodoStorageError("保存するアプリデータの形式が正しくありません。");
  }

  const previousRaw = readStorage(storage, APP_STORAGE_KEY);
  let backups = state.backups ?? [];
  if (previousRaw !== null) {
    const previous = parseAppState(previousRaw);
    backups = previous.backups;
    if (createBackup && !sameAppData(data, previous)) {
      backups = [
        ...backups,
        {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          data: {
            todos: previous.todos,
            game: previous.game,
            calendarEvents: previous.calendarEvents,
          },
        },
      ].slice(-MAX_AUTOMATIC_BACKUPS);
    }
  }
  if (
    !Array.isArray(backups) ||
    backups.length > MAX_AUTOMATIC_BACKUPS ||
    !backups.every(isBackupRecord)
  ) {
    throw new TodoStorageError("自動バックアップの形式が正しくありません。");
  }

  const serialized = JSON.stringify({
    schemaVersion: APP_SCHEMA_VERSION,
    todos: data.todos,
    game: data.game,
    calendarEvents: data.calendarEvents,
    backups,
  });
  try {
    storage.setItem(APP_STORAGE_KEY, serialized);
  } catch {
    try {
      storage.setItem(APP_STORAGE_KEY, serialized);
    } catch (cause) {
      throw new TodoStorageError(
        "データと自動バックアップを保存できませんでした。変更は反映されていません。",
        { cause },
      );
    }
  }
  return { ...data, backups };
}

function readStorage(storage, key) {
  try {
    return storage.getItem(key);
  } catch (cause) {
    throw new TodoStorageError("端末内のデータを読み込めませんでした。", { cause });
  }
}

function advanceRoutineDates(todos, today) {
  try {
    return advanceMissedRoutineTodos(todos, today);
  } catch (cause) {
    if (!(cause instanceof RangeError)) {
      throw cause;
    }
    throw new TodoStorageError(
      "ルーティンの次回日付を計算できません。保存データは変更していません。",
      { cause },
    );
  }
}

function parseAppState(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new TodoStorageError("保存データを解析できません。データは変更していません。", {
      cause,
    });
  }
  if (
    ![1, 2, 3, 4, 5, 6, 7, APP_SCHEMA_VERSION].includes(parsed?.schemaVersion) ||
    !Array.isArray(parsed.todos) ||
    !parsed.todos.every(isTodoRecord) ||
    (parsed.calendarEvents !== undefined &&
      (!Array.isArray(parsed.calendarEvents) ||
        !parsed.calendarEvents.every(isCalendarEvent))) ||
    parsed.game === null ||
    typeof parsed.game !== "object" ||
    (parsed.backups !== undefined &&
      (!Array.isArray(parsed.backups) ||
        parsed.backups.length > MAX_AUTOMATIC_BACKUPS ||
        !parsed.backups.every(isBackupRecord)))
  ) {
    throw new TodoStorageError("保存データの形式が正しくありません。データは変更していません。");
  }
  const game = {
    ...parsed.game,
    loginBonus:
      parsed.game.loginBonus ??
      createInitialGameState().loginBonus,
  };
  game.loginBonus.lastClaimedDay ??= null;
  if (!isGameState(game)) {
    throw new TodoStorageError("保存データの形式が正しくありません。データは変更していません。");
  }
  const data = normalizeAppData({
    todos: parsed.todos,
    game,
    calendarEvents: parsed.calendarEvents ?? [],
  });
  if (!data) {
    throw new TodoStorageError("保存データの形式が正しくありません。データは変更していません。");
  }
  return {
    schemaVersion: parsed.schemaVersion,
    ...data,
    backups: parsed.backups ?? [],
  };
}

export function validateAppData(data) {
  return normalizeAppData(data);
}

function normalizeAppData(data) {
  if (
    !data ||
    !Array.isArray(data.todos) ||
    !data.todos.every(isTodoRecord) ||
    (data.calendarEvents !== undefined &&
      (!Array.isArray(data.calendarEvents) ||
        !data.calendarEvents.every(isCalendarEvent))) ||
    !data.game ||
    typeof data.game !== "object"
  ) {
    return null;
  }
  const todos = data.todos.map((todo) => {
    const routineRule =
      todo.category === "routine"
        ? todo.routineRule ??
          createDefaultRoutineRule(
            todo.dueDate ??
              todo.startDate ??
              (isDateKey(String(todo.createdAt).slice(0, 10))
                ? String(todo.createdAt).slice(0, 10)
                : getLocalDateKey()),
          )
        : null;
    return {
      ...todo,
      notificationsEnabled: todo.notificationsEnabled ?? true,
      parentId: todo.parentId || null,
      childOrder: todo.parentId ? todo.childOrder ?? null : null,
      childDisplayMode: todo.childDisplayMode ?? "all",
      displayGroup: todo.parentId ? todo.displayGroup ?? 1 : null,
      dueDate: todo.category === "routine" ? todo.dueDate ?? routineRule.anchorDate : todo.dueDate,
      routineRule,
      routineLastCompletedAt: todo.routineLastCompletedAt ?? null,
    };
  });
  if (!isValidTodoHierarchy(todos)) {
    return null;
  }
  const normalizedTodos = normalizeChildOrders(todos);
  const todoIds = new Set(normalizedTodos.map((todo) => todo.id));
  const calendarEvents = data.calendarEvents ?? [];
  if (calendarEvents.some((event) => event.todoIds.some((id) => !todoIds.has(id)))) {
    return null;
  }
  const game = {
    ...data.game,
    loginBonus: data.game.loginBonus ?? createInitialGameState().loginBonus,
  };
  game.loginBonus.lastClaimedDay ??= null;
  if (!isGameState(game)) {
    return null;
  }
  return {
    todos: normalizedTodos,
    game,
    calendarEvents: calendarEvents.map((event) => ({
      ...event,
      notificationsEnabled: event.notificationsEnabled ?? true,
      todoIds: expandLinkedTodoIds(normalizedTodos, event.todoIds),
    })),
  };
}

function isValidTodoHierarchy(todos) {
  const todosById = new Map(todos.map((todo) => [todo.id, todo]));
  if (todosById.size !== todos.length) {
    return false;
  }

  for (const todo of todos) {
    const visited = new Set([todo.id]);
    let parentId = todo.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        return false;
      }
      visited.add(parentId);
      const parent = todosById.get(parentId);
      if (!parent) {
        return false;
      }
      parentId = parent.parentId;
    }
  }
  return true;
}

function normalizeChildOrders(todos) {
  const indexedTodos = todos.map((todo, index) => ({ todo, index }));
  const childrenByParent = new Map();
  for (const entry of indexedTodos) {
    if (!entry.todo.parentId) {
      continue;
    }
    const siblings = childrenByParent.get(entry.todo.parentId) ?? [];
    siblings.push(entry);
    childrenByParent.set(entry.todo.parentId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => {
      const leftOrder = left.todo.childOrder ?? Number.POSITIVE_INFINITY;
      const rightOrder = right.todo.childOrder ?? Number.POSITIVE_INFINITY;
      return leftOrder - rightOrder || left.index - right.index;
    });
    siblings.forEach(({ todo }, order) => {
      todo.childOrder = order;
    });
  }
  return todos;
}

function expandLinkedTodoIds(todos, linkedIds) {
  const selectedIds = new Set(linkedIds);
  const queue = [...selectedIds];
  for (let index = 0; index < queue.length; index += 1) {
    for (const todo of todos) {
      if (todo.parentId === queue[index] && !selectedIds.has(todo.id)) {
        selectedIds.add(todo.id);
        queue.push(todo.id);
      }
    }
  }
  return todos.filter((todo) => selectedIds.has(todo.id)).map((todo) => todo.id);
}

function sameAppData(left, right) {
  return (
    JSON.stringify(left) ===
    JSON.stringify({
      todos: right.todos,
      game: right.game,
      calendarEvents: right.calendarEvents,
    })
  );
}

function isBackupRecord(backup) {
  return (
    backup !== null &&
    typeof backup === "object" &&
    typeof backup.id === "string" &&
    isTimestamp(backup.createdAt) &&
    normalizeAppData(backup.data) !== null
  );
}

function isCalendarEvent(event) {
  const isTime = (value) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const isDuration = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1440;
  const validCommon =
    event !== null &&
    typeof event === "object" &&
    typeof event.id === "string" &&
    typeof event.title === "string" &&
    isDateKey(event.date) &&
    typeof event.completed === "boolean" &&
    (event.notificationsEnabled === undefined ||
      typeof event.notificationsEnabled === "boolean") &&
    (event.completedAt === null || typeof event.completedAt === "string") &&
    typeof event.createdAt === "string" &&
    typeof event.updatedAt === "string" &&
    Array.isArray(event.todoIds) &&
    event.todoIds.every((id) => typeof id === "string");
  if (!validCommon) {
    return false;
  }
  if (event.type === "appointment") {
    return (
      isTime(event.startTime) &&
      isDuration(event.travelMinutes) &&
      isDuration(event.preparationMinutes) &&
      isDuration(event.arrivalLeadMinutes) &&
      typeof event.location === "string"
    );
  }
  if (event.type === "deadline") {
    return (
      isTime(event.dueTime) &&
      Array.isArray(event.notificationOffsets) &&
      event.notificationOffsets.every((offset) =>
        ["30m", "1h", "3h", "1d", "3d", "7d"].includes(offset),
      )
    );
  }
  return false;
}

function isTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function assertStorage(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new TodoStorageError("このブラウザーではローカル保存を利用できません。");
  }
}

function getDefaultStorage() {
  try {
    return globalThis.localStorage;
  } catch (cause) {
    throw new TodoStorageError("このブラウザーではローカル保存を利用できません。", { cause });
  }
}

function isGameState(game) {
  return (
    game !== null &&
    typeof game === "object" &&
    Number.isSafeInteger(game.normalPoints) &&
    game.normalPoints >= 0 &&
    Number.isSafeInteger(game.attackPoints) &&
    game.attackPoints >= 0 &&
    Number.isSafeInteger(game.jewels) &&
    game.jewels >= 0 &&
    Array.isArray(game.rewardedEventIds) &&
    game.rewardedEventIds.every((id) => typeof id === "string") &&
    Number.isSafeInteger(game.area) &&
    game.area >= 1 &&
    Number.isSafeInteger(game.position) &&
    game.position >= 0 &&
    isLoginBonusState(game.loginBonus)
  );
}

function isLoginBonusState(loginBonus) {
  return (
    loginBonus !== null &&
    typeof loginBonus === "object" &&
    Number.isSafeInteger(loginBonus.nextDay) &&
    loginBonus.nextDay >= 1 &&
    loginBonus.nextDay <= 7 &&
    (loginBonus.lastClaimDate === null || isDateKey(loginBonus.lastClaimDate)) &&
    (loginBonus.lastClaimedDay === null ||
      (Number.isSafeInteger(loginBonus.lastClaimedDay) &&
        loginBonus.lastClaimedDay >= 1 &&
        loginBonus.lastClaimedDay <= 7))
  );
}

function isTodoRecord(todo) {
  return (
    todo !== null &&
    typeof todo === "object" &&
    typeof todo.id === "string" &&
    typeof todo.title === "string" &&
    (todo.notificationsEnabled === undefined ||
      typeof todo.notificationsEnabled === "boolean") &&
    (todo.parentId === undefined || todo.parentId === null || typeof todo.parentId === "string") &&
    (todo.childOrder === undefined ||
      todo.childOrder === null ||
      (Number.isSafeInteger(todo.childOrder) && todo.childOrder >= 0)) &&
    (todo.childDisplayMode === undefined ||
      ["all", "sequential", "custom"].includes(todo.childDisplayMode)) &&
    (todo.displayGroup === undefined ||
      todo.displayGroup === null ||
      (Number.isSafeInteger(todo.displayGroup) &&
        todo.displayGroup >= 1 &&
        todo.displayGroup <= 100)) &&
    (todo.routineRule === undefined ||
      todo.routineRule === null ||
      isRoutineRule(todo.routineRule)) &&
    (todo.routineLastCompletedAt === undefined ||
      todo.routineLastCompletedAt === null ||
      typeof todo.routineLastCompletedAt === "string") &&
    ["main", "routine", "other"].includes(todo.category) &&
    (todo.startDate === null || isDateKey(todo.startDate)) &&
    (todo.dueDate === null || isDateKey(todo.dueDate)) &&
    Array.isArray(todo.checklist) &&
    todo.checklist.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.text === "string" &&
        typeof item.completed === "boolean",
    ) &&
    Array.isArray(todo.links) &&
    todo.links.every(isSafeLink) &&
    typeof todo.completed === "boolean" &&
    (todo.completedAt === null || typeof todo.completedAt === "string") &&
    typeof todo.createdAt === "string" &&
    typeof todo.updatedAt === "string"
  );
}

function isSafeLink(value) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
