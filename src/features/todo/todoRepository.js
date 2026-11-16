import { pruneExpiredTodos } from "./todoService.js";

export const TODO_STORAGE_KEY = "daily-tool.todos.v1";

export class TodoStorageError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "TodoStorageError";
  }
}

export function loadTodos(storage, today) {
  storage ??= getDefaultStorage();
  assertStorage(storage);

  let raw;
  try {
    raw = storage.getItem(TODO_STORAGE_KEY);
  } catch (cause) {
    throw new TodoStorageError("Todoデータを読み込めませんでした。", { cause });
  }
  if (raw === null) {
    return [];
  }

  let todos;
  try {
    todos = JSON.parse(raw);
  } catch (cause) {
    throw new TodoStorageError("Todoデータを解析できません。データは変更していません。", {
      cause,
    });
  }
  if (!Array.isArray(todos) || !todos.every(isTodoRecord)) {
    throw new TodoStorageError("Todoデータの形式が正しくありません。データは変更していません。");
  }

  const retained = pruneExpiredTodos(todos, today);
  if (retained.length !== todos.length) {
    saveTodos(retained, storage);
  }
  return retained;
}

export function saveTodos(todos, storage) {
  storage ??= getDefaultStorage();
  assertStorage(storage);
  try {
    storage.setItem(TODO_STORAGE_KEY, JSON.stringify(todos));
  } catch (cause) {
    throw new TodoStorageError("Todoデータを保存できませんでした。変更は反映されていません。", {
      cause,
    });
  }
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
