const DEADLINE_OFFSETS = ["30m", "1h", "3h", "1d", "3d", "7d"];

export class CalendarValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CalendarValidationError";
  }
}

export function createCalendarEvent(input, { id = crypto.randomUUID(), now = new Date() } = {}) {
  if (!input || typeof input !== "object") {
    throw new CalendarValidationError("予定・締切の内容を確認してください。");
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const type = input.type;
  const date = normalizeDate(input.date);
  if (!title) {
    throw new CalendarValidationError("予定名・締切名を入力してください。");
  }
  if (title.length > 160) {
    throw new CalendarValidationError("名前は160文字以内で入力してください。");
  }

  const timestamp = now.toISOString();
  const todoIds = input.todoIds ?? [];
  if (!Array.isArray(todoIds) || !todoIds.every((todoId) => typeof todoId === "string")) {
    throw new CalendarValidationError("紐付けるTodoを確認してください。");
  }
  const common = {
    id,
    type,
    title,
    date,
    todoIds: [...new Set(todoIds)],
    completed: false,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (type === "appointment") {
    return {
      ...common,
      startTime: normalizeTime(input.startTime, "開始時刻"),
      travelMinutes: normalizeDuration(input.travelMinutes, "移動時間"),
      preparationMinutes: normalizeDuration(input.preparationMinutes, "準備時間"),
      arrivalLeadMinutes: normalizeDuration(input.arrivalLeadMinutes, "到着希望時間"),
      location: String(input.location ?? "").trim(),
    };
  }
  if (type === "deadline") {
    if (!Array.isArray(input.notificationOffsets)) {
      throw new CalendarValidationError("通知タイミングを確認してください。");
    }
    const notificationOffsets = [...new Set(input.notificationOffsets)];
    if (!notificationOffsets.every((offset) => DEADLINE_OFFSETS.includes(offset))) {
      throw new CalendarValidationError("選択できない通知タイミングが含まれています。");
    }
    return {
      ...common,
      dueTime: normalizeTime(input.dueTime, "締切時刻"),
      notificationOffsets,
    };
  }
  throw new CalendarValidationError("登録対象を選択してください。");
}

export function setCalendarCompletion(events, id, completed, now = new Date()) {
  return events.map((event) => {
    if (event.id !== id || event.completed === completed) {
      return event;
    }
    return {
      ...event,
      completed,
      completedAt: completed ? now.toISOString() : null,
      updatedAt: now.toISOString(),
    };
  });
}

export function getCurrentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(monthKey, amount) {
  const [year, month] = parseMonthKey(monthKey);
  const date = new Date(year, month - 1 + amount, 1);
  return getCurrentMonthKey(date);
}

export function getCalendarDays(monthKey, today = getLocalDateKey()) {
  const [year, month] = parseMonthKey(monthKey);
  const first = new Date(year, month - 1, 1);
  const leadingDays = first.getDay();
  const monthLength = new Date(year, month, 0).getDate();
  const cellCount = Math.ceil((leadingDays + monthLength) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(year, month - 1, index - leadingDays + 1);
    const dateKey = getLocalDateKey(date);
    return {
      date: dateKey,
      day: date.getDate(),
      inMonth: date.getMonth() === month - 1,
      isToday: dateKey === today,
    };
  });
}

export function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatEventTime(event) {
  return event.type === "appointment" ? event.startTime : event.dueTime;
}

function parseMonthKey(value) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new CalendarValidationError("表示する年月が正しくありません。");
  }
  const [year, month] = value.split("-").map(Number);
  return [year, month];
}

function normalizeDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ||
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new CalendarValidationError("日付を正しく入力してください。");
  }
  return value;
}

function normalizeTime(value, label) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new CalendarValidationError(`${label}を正しく入力してください。`);
  }
  return value;
}

function normalizeDuration(value, label) {
  const duration = Number(value);
  if (!Number.isSafeInteger(duration) || duration < 0 || duration > 1440) {
    throw new CalendarValidationError(`${label}は0〜1440分で入力してください。`);
  }
  return duration;
}
