const ROUTINE_TYPES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "interval",
  "monthly-weekday",
  "yearly-weekday",
];
const ROUTINE_UNITS = ["days", "weeks", "months", "years"];
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export function createDefaultRoutineRule(anchorDate) {
  return { type: "daily", anchorDate };
}

export function normalizeRoutineRule(value) {
  if (!value || typeof value !== "object" || !ROUTINE_TYPES.includes(value.type)) {
    return null;
  }
  const anchorDate = value.anchorDate;
  if (!isDateKey(anchorDate)) {
    return null;
  }
  if (value.type === "daily" || value.type === "weekly") {
    return { type: value.type, anchorDate };
  }
  if (value.type === "monthly") {
    const day = integer(value.day ?? Number(anchorDate.slice(8)), 1, 31);
    return day === null ? null : { type: value.type, anchorDate, day };
  }
  if (value.type === "yearly") {
    const month = integer(value.month ?? Number(anchorDate.slice(5, 7)), 1, 12);
    const day = integer(value.day ?? Number(anchorDate.slice(8)), 1, 31);
    return month === null || day === null
      ? null
      : { type: value.type, anchorDate, month, day };
  }
  if (value.type === "interval") {
    const interval = integer(value.interval, 1, 999);
    return interval === null || !ROUTINE_UNITS.includes(value.unit)
      ? null
      : { type: value.type, anchorDate, interval, unit: value.unit };
  }
  const weekday = integer(value.weekday, 0, 6);
  const ordinal = normalizeOrdinal(value.ordinal);
  if (weekday === null || ordinal === null) {
    return null;
  }
  if (value.type === "monthly-weekday") {
    return { type: value.type, anchorDate, weekday, ordinal };
  }
  const month = integer(value.month, 1, 12);
  return month === null ? null : { type: value.type, anchorDate, month, weekday, ordinal };
}

export function isRoutineRule(value) {
  return normalizeRoutineRule(value) !== null;
}

export function getFirstRoutineDate(ruleValue) {
  const rule = normalizeRoutineRule(ruleValue);
  if (!rule) {
    throw new TypeError("ルーティン周期の設定が正しくありません。");
  }
  if (
    rule.type === "daily" ||
    rule.type === "weekly" ||
    rule.type === "interval"
  ) {
    return rule.anchorDate;
  }
  const anchor = parseDateKey(rule.anchorDate);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + 1;
  let scheduledDate = null;
  if (rule.type === "monthly") {
    scheduledDate = makeDateKey(year, month, rule.day);
  } else if (rule.type === "yearly") {
    scheduledDate = getYearlyOccurrence(rule, year);
  } else if (rule.type === "monthly-weekday") {
    scheduledDate = getWeekdayOccurrence(year, month, rule.weekday, rule.ordinal);
  } else if (rule.type === "yearly-weekday") {
    scheduledDate = getYearlyOccurrence(rule, year);
  }
  if (scheduledDate === rule.anchorDate) {
    return scheduledDate;
  }
  return getNextRoutineDate(rule, rule.anchorDate);
}

export function getNextRoutineDate(ruleValue, afterDate) {
  const rule = normalizeRoutineRule(ruleValue);
  if (!rule || !isDateKey(afterDate)) {
    throw new TypeError("ルーティン周期または基準日が正しくありません。");
  }

  const anchor = parseDateKey(rule.anchorDate);
  const after = parseDateKey(afterDate);
  const dayStep = getDayStep(rule);
  if (dayStep !== null) {
    const daysSinceAnchor = dayOrdinal(afterDate) - dayOrdinal(rule.anchorDate);
    const occurrence = Math.max(0, Math.floor(daysSinceAnchor / dayStep) + 1);
    return addDays(rule.anchorDate, occurrence * dayStep);
  }

  const monthStep = getMonthStep(rule);
  if (monthStep !== null) {
    const monthsSinceAnchor =
      (after.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      after.getUTCMonth() -
      anchor.getUTCMonth();
    let occurrence = Math.max(0, Math.floor(monthsSinceAnchor / monthStep));
    for (let attempts = 0; attempts < 12000; attempts += 1, occurrence += 1) {
      const month = addMonths(rule.anchorDate, occurrence * monthStep);
      const candidate = getMonthlyOccurrence(rule, month);
      if (candidate && candidate >= rule.anchorDate && candidate > afterDate) {
        return candidate;
      }
    }
    throw new RangeError("ルーティンの次回日付を計算できません。");
  }

  const yearStep = getYearStep(rule);
  const yearsSinceAnchor = after.getUTCFullYear() - anchor.getUTCFullYear();
  let occurrence = Math.max(0, Math.floor(yearsSinceAnchor / yearStep));
  for (let attempts = 0; attempts < 12000; attempts += 1, occurrence += 1) {
    const year = anchor.getUTCFullYear() + occurrence * yearStep;
    const candidate = getYearlyOccurrence(rule, year);
    if (candidate && candidate >= rule.anchorDate && candidate > afterDate) {
      return candidate;
    }
  }
  throw new RangeError("ルーティンの次回日付を計算できません。");
}

export function advanceRoutineTodo(todo, todos, completedAt, now = new Date()) {
  if (todo.category !== "routine" || !todo.routineRule || !todo.completed || !todo.completedAt) {
    return todos;
  }
  const nextDate = getNextRoutineDate(todo.routineRule, getDateKey(completedAt));
  return todos.map((item) =>
    item.id === todo.id
      ? {
          ...item,
          startDate: item.startDate ? nextDate : null,
          dueDate: nextDate,
          completed: false,
          completedAt: null,
          checklist: item.checklist.map((entry) => ({ ...entry, completed: false })),
          routineLastCompletedAt: todo.completedAt,
          updatedAt: now.toISOString(),
        }
      : item,
  );
}

export function advanceMissedRoutineTodos(todos, today, now = new Date()) {
  let changed = false;
  const nextTodos = todos.map((todo) => {
    if (
      todo.category !== "routine" ||
      !todo.routineRule ||
      !todo.dueDate ||
      todo.dueDate >= today
    ) {
      return todo;
    }
    const nextDate = getNextRoutineDate(todo.routineRule, addDays(today, -1));
    changed = true;
    return {
      ...todo,
      startDate: todo.startDate ? nextDate : null,
      dueDate: nextDate,
      completed: false,
      completedAt: null,
      checklist: todo.checklist.map((entry) => ({ ...entry, completed: false })),
      updatedAt: now.toISOString(),
    };
  });
  return changed ? nextTodos : todos;
}

export function getRoutineLabel(ruleValue) {
  const rule = normalizeRoutineRule(ruleValue);
  if (!rule) {
    return "";
  }
  if (rule.type === "daily") {
    return "毎日";
  }
  if (rule.type === "weekly") {
    return "毎週";
  }
  if (rule.type === "monthly") {
    return `毎月${rule.day}日`;
  }
  if (rule.type === "yearly") {
    return `毎年${rule.month}月${rule.day}日`;
  }
  if (rule.type === "interval") {
    const units = { days: "日", weeks: "週間", months: "か月", years: "年" };
    return `${rule.interval}${units[rule.unit]}ごと`;
  }
  const ordinal = rule.ordinal === "last" ? "最後" : `第${rule.ordinal}`;
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][rule.weekday];
  return rule.type === "monthly-weekday"
    ? `毎月${ordinal}${weekday}曜日`
    : `毎年${rule.month}月の${ordinal}${weekday}曜日`;
}

function getDayStep(rule) {
  if (rule.type === "daily") {
    return 1;
  }
  if (rule.type === "weekly") {
    return 7;
  }
  if (rule.type !== "interval") {
    return null;
  }
  if (rule.unit === "days") {
    return rule.interval;
  }
  if (rule.unit === "weeks") {
    return rule.interval * 7;
  }
  return null;
}

function getMonthStep(rule) {
  if (rule.type === "monthly" || rule.type === "monthly-weekday") {
    return 1;
  }
  return rule.type === "interval" && rule.unit === "months" ? rule.interval : null;
}

function getYearStep(rule) {
  if (rule.type === "yearly" || rule.type === "yearly-weekday") {
    return 1;
  }
  return rule.type === "interval" && rule.unit === "years" ? rule.interval : null;
}

function getMonthlyOccurrence(rule, monthKey) {
  const date = parseDateKey(monthKey);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (rule.type === "monthly" || (rule.type === "interval" && rule.unit === "months")) {
    return makeDateKey(year, month, rule.type === "monthly" ? rule.day : Number(rule.anchorDate.slice(8)));
  }
  return getWeekdayOccurrence(year, month, rule.weekday, rule.ordinal);
}

function getYearlyOccurrence(rule, year) {
  if (rule.type === "yearly" || (rule.type === "interval" && rule.unit === "years")) {
    const month = rule.type === "yearly" ? rule.month : Number(rule.anchorDate.slice(5, 7));
    const day = rule.type === "yearly" ? rule.day : Number(rule.anchorDate.slice(8));
    return makeDateKey(year, month, day);
  }
  return getWeekdayOccurrence(year, rule.month, rule.weekday, rule.ordinal);
}

function getWeekdayOccurrence(year, month, weekday, ordinal) {
  const lastDay = daysInMonth(year, month);
  if (ordinal === "last") {
    const lastWeekday = makeUtcDate(year, month, lastDay).getUTCDay();
    return makeDateKey(year, month, lastDay - ((lastWeekday - weekday + 7) % 7));
  }
  const firstWeekday = makeUtcDate(year, month, 1).getUTCDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (ordinal - 1) * 7;
  return day <= lastDay ? makeDateKey(year, month, day) : null;
}

function addDays(dateKey, days) {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return makeDateKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

function addMonths(dateKey, months) {
  const date = parseDateKey(dateKey);
  const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return makeDateKey(year, month, 1);
}

function makeDateKey(year, month, day) {
  if (!Number.isSafeInteger(year) || year < 1 || year > 9999) {
    throw new RangeError("次回のルーティン日が対応範囲を超えています。");
  }
  const normalizedDay = Math.min(day, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(normalizedDay).padStart(2, "0")}`;
}

function daysInMonth(year, month) {
  return makeUtcDate(year, month + 1, 0).getUTCDate();
}

function dayOrdinal(dateKey) {
  return parseDateKey(dateKey).getTime() / DAY_MILLISECONDS;
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return makeUtcDate(year, month, day);
}

function makeUtcDate(year, month, day) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function getDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new TypeError("完了日時が正しくありません。");
  }
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = parseDateKey(value);
  return (
    !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCFullYear() >= 1
  );
}

function integer(value, minimum, maximum) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function normalizeOrdinal(value) {
  if (value === "last") {
    return "last";
  }
  return integer(value, 1, 5);
}
