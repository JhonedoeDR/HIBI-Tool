import { pruneExpiredTodos } from "./todoService.js";

export const APP_STORAGE_KEY = "daily-tool.state.v1";
export const TODO_STORAGE_KEY = "daily-tool.todos.v1";

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
  };
}

export function loadAppState(storage, today) {
  storage ??= getDefaultStorage();
  assertStorage(storage);

  const raw = readStorage(storage, APP_STORAGE_KEY);
  if (raw !== null) {
    const state = parseAppState(raw);
    const todos = pruneExpiredTodos(state.todos, today);
    if (todos.length !== state.todos.length) {
      saveAppState({ ...state, todos }, storage);
    }
    return { ...state, todos };
  }

  const legacyTodos = readStorage(storage, TODO_STORAGE_KEY);
  if (legacyTodos === null) {
    return { todos: [], game: createInitialGameState() };
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

  const state = { todos: pruneExpiredTodos(todos, today), game: createInitialGameState() };
  saveAppState(state, storage);
  return state;
}

export function saveAppState(state, storage) {
  storage ??= getDefaultStorage();
  assertStorage(storage);
  if (
    !state ||
    !Array.isArray(state.todos) ||
    !state.todos.every(isTodoRecord) ||
    !isGameState(state.game)
  ) {
    throw new TodoStorageError("保存するアプリデータの形式が正しくありません。");
  }

  try {
    storage.setItem(
      APP_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, todos: state.todos, game: state.game }),
    );
  } catch (cause) {
    throw new TodoStorageError("データを保存できませんでした。変更は反映されていません。", {
      cause,
    });
  }
}

function readStorage(storage, key) {
  try {
    return storage.getItem(key);
  } catch (cause) {
    throw new TodoStorageError("端末内のデータを読み込めませんでした。", { cause });
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
    parsed?.schemaVersion !== 1 ||
    !Array.isArray(parsed.todos) ||
    !parsed.todos.every(isTodoRecord) ||
    !isGameState(parsed.game)
  ) {
    throw new TodoStorageError("保存データの形式が正しくありません。データは変更していません。");
  }
  return { todos: parsed.todos, game: parsed.game };
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
    game.position >= 0
  );
}

function isTodoRecord(todo) {
  return (
    todo !== null &&
    typeof todo === "object" &&
    typeof todo.id === "string" &&
    typeof todo.title === "string" &&
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
