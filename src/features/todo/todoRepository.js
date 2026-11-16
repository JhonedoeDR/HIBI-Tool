import { pruneExpiredTodos } from "./todoService.js";

export const APP_STORAGE_KEY = "daily-tool.state.v1";
export const TODO_STORAGE_KEY = "daily-tool.todos.v1";
export const MAX_AUTOMATIC_BACKUPS = 10;
const APP_SCHEMA_VERSION = 3;

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

export function loadAppState(storage, today) {
  storage ??= getDefaultStorage();
  assertStorage(storage);

  const raw = readStorage(storage, APP_STORAGE_KEY);
  if (raw !== null) {
    const parsedState = parseAppState(raw);
    const { schemaVersion, ...state } = parsedState;
    const todos = pruneExpiredTodos(state.todos, today);
    const updatedState = { ...state, todos };
    if (schemaVersion !== APP_SCHEMA_VERSION || todos.length !== state.todos.length) {
      return saveAppState(updatedState, storage);
    }
    return updatedState;
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
          data: { todos: previous.todos, game: previous.game },
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
    ![1, 2, APP_SCHEMA_VERSION].includes(parsed?.schemaVersion) ||
    !Array.isArray(parsed.todos) ||
    !parsed.todos.every(isTodoRecord) ||
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
  return {
    schemaVersion: parsed.schemaVersion,
    todos: parsed.todos,
    game,
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
    !data.game ||
    typeof data.game !== "object"
  ) {
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
  return { todos: data.todos, game };
}

function sameAppData(left, right) {
  return JSON.stringify(left) === JSON.stringify({ todos: right.todos, game: right.game });
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
