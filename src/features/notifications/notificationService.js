const DEADLINE_OFFSETS = [
  { value: "30m", label: "30分前", minutes: 30 },
  { value: "1h", label: "1時間前", minutes: 60 },
  { value: "3h", label: "3時間前", minutes: 180 },
  { value: "1d", label: "前日", days: 1 },
  { value: "3d", label: "3日前", days: 3 },
  { value: "7d", label: "1週間前", days: 7 },
];

export function getTodoReminderSchedule(todo, now = new Date()) {
  if (todo.completed) {
    return [];
  }
  const reminders = [];
  if (todo.startDate) {
    reminders.push({
      scheduledAt: makeLocalDateTime(todo.startDate, "08:00"),
      label: "開始日",
    });
  }
  if (todo.dueDate) {
    reminders.push({
      scheduledAt: makeLocalDateTime(shiftDate(todo.dueDate, -1), "08:00"),
      label: "期限前日",
    });
    reminders.push({
      scheduledAt: makeLocalDateTime(todo.dueDate, "08:00"),
      label: "期限当日",
    });
  }
  return groupReminders(reminders, {
    sourceType: "todo",
    sourceId: todo.id,
    title: todo.title,
    now,
  });
}

export function getCalendarReminderSchedule(event, now = new Date()) {
  if (event.completed) {
    return [];
  }
  const reminders = [];
  if (event.type === "appointment") {
    const start = makeLocalDateTime(event.date, event.startTime);
    const leave = addMinutes(start, -(event.travelMinutes + event.arrivalLeadMinutes));
    const preparation = addMinutes(leave, -event.preparationMinutes);
    reminders.push(
      { scheduledAt: preparation, label: "準備開始" },
      { scheduledAt: leave, label: "出発" },
      { scheduledAt: start, label: "予定開始" },
    );
  } else if (event.type === "deadline") {
    for (const offset of event.notificationOffsets) {
      const definition = DEADLINE_OFFSETS.find((item) => item.value === offset);
      if (!definition) {
        throw new TypeError("締切通知のタイミングが正しくありません。");
      }
      const due = makeLocalDateTime(event.date, event.dueTime);
      reminders.push({
        scheduledAt: definition.days
          ? shiftLocalDate(due, -definition.days)
          : addMinutes(due, -definition.minutes),
        label: definition.label,
      });
    }
  } else {
    throw new TypeError("カレンダーの予定種別が正しくありません。");
  }
  return groupReminders(reminders, {
    sourceType: "calendar",
    sourceId: event.id,
    title: event.title,
    now,
  });
}

export function getUpcomingReminderSchedule(todos, calendarEvents, now = new Date()) {
  return [
    ...todos.flatMap((todo) => getTodoReminderSchedule(todo, now)),
    ...calendarEvents.flatMap((event) => getCalendarReminderSchedule(event, now)),
  ].sort((left, right) => left.scheduledAt - right.scheduledAt);
}

export function formatReminderTime(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function groupReminders(reminders, { sourceType, sourceId, title, now }) {
  const grouped = new Map();
  for (const reminder of reminders) {
    if (reminder.scheduledAt <= now) {
      continue;
    }
    const key = reminder.scheduledAt.getTime();
    const existing = grouped.get(key);
    if (existing) {
      existing.labels.push(reminder.label);
    } else {
      grouped.set(key, {
        id: `${sourceType}:${sourceId}:${key}`,
        sourceType,
        sourceId,
        title,
        scheduledAt: reminder.scheduledAt,
        labels: [reminder.label],
      });
    }
  }
  return [...grouped.values()].sort((left, right) => left.scheduledAt - right.scheduledAt);
}

function makeLocalDateTime(dateKey, time) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    Number.isNaN(date.valueOf()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new TypeError("通知日時が正しくありません。");
  }
  return date;
}

function shiftDate(dateKey, amount) {
  const date = makeLocalDateTime(dateKey, "12:00");
  date.setDate(date.getDate() + amount);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function shiftLocalDate(date, amount) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + amount);
  return shifted;
}

function addMinutes(date, amount) {
  return new Date(date.getTime() + amount * 60 * 1000);
}
