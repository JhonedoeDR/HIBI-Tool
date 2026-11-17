import { getCalendarDays, formatEventTime } from "../features/calendar/calendarService.js";
import { expandTodoSelection } from "../features/todo/todoService.js";
import {
  formatReminderTime,
  getCalendarReminderSchedule,
} from "../features/notifications/notificationService.js";
import { renderSidebar } from "./renderTodoPage.js";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const DEADLINE_OFFSETS = [
  ["30m", "30分前"],
  ["1h", "1時間前"],
  ["3h", "3時間前"],
  ["1d", "前日"],
  ["3d", "3日前"],
  ["7d", "1週間前"],
];

export function renderCalendarPage(state) {
  const shell = document.createElement("div");
  shell.className = "app-layout";
  shell.append(renderSidebar("calendar"));

  const main = document.createElement("main");
  main.className = "main-content calendar-page";
  const heading = document.createElement("header");
  heading.className = "page-heading";
  const headingCopy = document.createElement("div");
  const eyebrow = make("p", "eyebrow", "PLAN YOUR TIME");
  const title = make("h1", "", "カレンダー");
  const description = make("p", "page-description", "予定と締切を月表示でまとめます。");
  headingCopy.append(eyebrow, title, description);
  const addButton = actionButton("＋ 予定・締切を追加", "primary-button", "new-calendar-event");
  addButton.disabled = !state.storageReady;
  heading.append(headingCopy, addButton);

  const monthBar = document.createElement("div");
  monthBar.className = "calendar-month-bar";
  monthBar.append(
    actionButton("‹", "month-nav-button", "previous-month"),
    make("h2", "calendar-month-title", formatMonth(state.calendarMonth)),
    actionButton("›", "month-nav-button", "next-month"),
  );
  const todayButton = actionButton("今月", "text-button", "current-month");
  monthBar.append(todayButton);

  const calendar = document.createElement("section");
  calendar.className = "calendar-grid";
  calendar.setAttribute("aria-label", "月間カレンダー");
  for (const weekday of WEEKDAYS) {
    const weekdayCell = make("div", "calendar-weekday", weekday);
    weekdayCell.setAttribute("aria-hidden", "true");
    calendar.append(weekdayCell);
  }

  for (const day of getCalendarDays(state.calendarMonth)) {
    const cell = document.createElement("article");
    cell.className = `calendar-day${day.inMonth ? "" : " is-outside-month"}${day.isToday ? " is-today" : ""}`;
    cell.setAttribute("aria-label", `${day.date}`);
    const dayNumber = make("span", "calendar-day-number", String(day.day));
    if (day.isToday) {
      dayNumber.setAttribute("aria-label", `今日 ${day.day}日`);
    }
    cell.append(dayNumber);

    const events = state.calendarEvents
      .filter((event) => event.date === day.date)
      .sort((left, right) => formatEventTime(left).localeCompare(formatEventTime(right)));
    const eventList = document.createElement("div");
    eventList.className = "calendar-day-events";
    for (const event of events) {
      const eventButton = actionButton(
        `${formatEventTime(event)} ${event.title}`,
        `calendar-event calendar-event-${event.type}${event.completed ? " is-completed" : ""}`,
        "show-calendar-event",
      );
      eventButton.dataset.eventId = event.id;
      eventButton.title = `${event.type === "appointment" ? "予定" : "締切・期限"}: ${event.title}`;
      eventList.append(eventButton);
    }
    cell.append(eventList);
    calendar.append(cell);
  }

  if (state.error) {
    const error = make("p", "error-banner", state.error);
    error.setAttribute("role", "alert");
    main.append(heading, error, monthBar, calendar);
  } else {
    main.append(heading, monthBar, calendar);
  }
  main.append(
    make(
      "p",
      "calendar-note",
      "カレンダーの内容は端末内に保存されます。プッシュ通知は通知設定から同期できます。Google Calendar同期は未実装です。",
    ),
  );

  shell.append(main, renderCalendarDialog(state), renderEventDetailsDialog(state));
  return shell;
}

function renderCalendarDialog(state) {
  const event = state.calendarEvents.find((item) => item.id === state.calendarEditingId);
  const dialog = make("dialog", "todo-dialog calendar-dialog");
  dialog.id = "calendar-dialog";
  dialog.setAttribute("aria-labelledby", "calendar-dialog-heading");
  const form = document.createElement("form");
  form.id = "calendar-event-form";
  form.className = "todo-form";

  const header = make("div", "dialog-header");
  const titleGroup = document.createElement("div");
  titleGroup.append(
    make("p", "eyebrow", "CALENDAR ENTRY"),
    make("h2", "", event ? "予定・締切を編集" : "予定・締切を登録"),
  );
  const close = actionButton("×", "dialog-close", "close-calendar-dialog");
  close.setAttribute("aria-label", "閉じる");
  header.append(titleGroup, close);

  const fields = document.createElement("div");
  fields.className = "form-fields";
  const typeSelect = document.createElement("select");
  typeSelect.id = "calendar-event-type";
  typeSelect.name = "type";
  typeSelect.dataset.action = "calendar-event-type";
  addOption(typeSelect, "appointment", "予定");
  addOption(typeSelect, "deadline", "締切・期限");
  typeSelect.value = event?.type ?? state.calendarType;
  fields.append(
    field("登録対象", typeSelect),
    field("名前", textInput("title", event?.title ?? "", true, "calendar-event-title")),
    field("日付", dateInput("date", event?.date ?? state.calendarDefaultDate)),
  );
  const todoLinks = renderTodoLinks(state.todos, event?.todoIds ?? []);

  const appointmentFields = document.createElement("fieldset");
  appointmentFields.className = "form-fields calendar-type-fields";
  appointmentFields.id = "appointment-fields";
  appointmentFields.hidden = typeSelect.value !== "appointment";
  appointmentFields.disabled = typeSelect.value !== "appointment";
  appointmentFields.append(
    make("legend", "field-label", "予定の詳細"),
    field("開始時刻", timeInput("startTime", event?.type === "appointment" ? event.startTime : "")),
    field(
      "移動時間（分）",
      numberInput("travelMinutes", event?.type === "appointment" ? event.travelMinutes : 0),
      "Google Maps連携は未実装です。必要な場合は手動で入力してください。",
    ),
    field(
      "準備時間（分）",
      numberInput("preparationMinutes", event?.type === "appointment" ? event.preparationMinutes : 0),
    ),
    field(
      "到着希望（開始の何分前）",
      numberInput("arrivalLeadMinutes", event?.type === "appointment" ? event.arrivalLeadMinutes : 0),
    ),
    field("場所（任意）", textInput("location", event?.type === "appointment" ? event.location : "")),
  );

  const deadlineFields = document.createElement("fieldset");
  deadlineFields.className = "form-fields calendar-type-fields";
  deadlineFields.id = "deadline-fields";
  deadlineFields.hidden = typeSelect.value !== "deadline";
  deadlineFields.disabled = typeSelect.value !== "deadline";
  deadlineFields.append(
    make("legend", "field-label", "締切・期限の詳細"),
    field("締切時刻", timeInput("dueTime", event?.type === "deadline" ? event.dueTime : "")),
  );
  const reminders = document.createElement("fieldset");
  reminders.className = "reminder-options";
  reminders.append(make("legend", "field-label", "通知タイミング（複数選択可）"));
  const selectedOffsets = event?.type === "deadline" ? event.notificationOffsets : [];
  for (const [value, label] of DEADLINE_OFFSETS) {
    const option = document.createElement("label");
    option.className = "reminder-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "notificationOffsets";
    checkbox.value = value;
    checkbox.checked = selectedOffsets.includes(value);
    option.append(checkbox, document.createTextNode(label));
    reminders.append(option);
  }
  deadlineFields.append(reminders);

  const error = make("p", "form-error", state.error);
  error.id = "calendar-form-error";
  error.setAttribute("role", "alert");
  const footer = document.createElement("div");
  footer.className = "dialog-actions";
  footer.append(
    actionButton("キャンセル", "secondary-button", "close-calendar-dialog"),
    submitButton(event ? "変更を保存" : "登録する"),
  );
  form.append(header, fields, todoLinks, appointmentFields, deadlineFields, error, footer);
  dialog.append(form);
  return dialog;
}

function renderTodoLinks(todos, selectedTodoIds) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "calendar-todo-links";
  fieldset.append(make("legend", "field-label", "関連Todo（複数選択可）"));

  if (!todos.length) {
    fieldset.append(make("p", "calendar-empty-links", "紐付けできるTodoはありません。"));
    return fieldset;
  }

  const selectedIds = new Set(expandTodoSelection(todos, selectedTodoIds));
  const sortedTodos = [...todos].sort((left, right) => left.title.localeCompare(right.title, "ja"));
  for (const todo of sortedTodos) {
    const option = document.createElement("label");
    option.className = "calendar-todo-link";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "todoIds";
    checkbox.value = todo.id;
    checkbox.checked = selectedIds.has(todo.id);
    checkbox.dataset.action = "calendar-todo-link";
    checkbox.dataset.todoId = todo.id;
    const parent = todos.find((item) => item.id === todo.parentId);
    option.append(
      checkbox,
      document.createTextNode(parent ? `${parent.title} › ${todo.title}` : todo.title),
    );
    fieldset.append(option);
  }
  return fieldset;
}

function renderEventDetailsDialog(state) {
  const event = state.calendarEvents.find((item) => item.id === state.calendarDetailId);
  const dialog = make("dialog", "todo-dialog calendar-details-dialog");
  dialog.id = "calendar-details-dialog";
  dialog.setAttribute("aria-labelledby", "calendar-details-heading");
  if (!event) {
    return dialog;
  }

  const content = document.createElement("div");
  content.className = "todo-form";
  const header = make("div", "dialog-header");
  const titleGroup = document.createElement("div");
  titleGroup.append(
    make("p", "eyebrow", event.type === "appointment" ? "APPOINTMENT" : "DEADLINE"),
    make("h2", "", event.title),
  );
  const close = actionButton("×", "dialog-close", "close-calendar-details");
  close.setAttribute("aria-label", "閉じる");
  header.append(titleGroup, close);

  const info = document.createElement("div");
  info.className = "calendar-detail-info";
  info.append(
    detailRow("日付", formatDate(event.date)),
    detailRow(event.type === "appointment" ? "開始時刻" : "締切時刻", formatEventTime(event)),
  );
  if (event.type === "appointment") {
    if (event.location) {
      info.append(detailRow("場所", event.location));
    }
    info.append(
      detailRow("移動時間", `${event.travelMinutes}分`),
      detailRow("準備時間", `${event.preparationMinutes}分`),
      detailRow("到着希望", `${event.arrivalLeadMinutes}分前`),
    );
  } else {
    const reminderLabels = event.notificationOffsets.map(
      (offset) => DEADLINE_OFFSETS.find(([value]) => value === offset)?.[1] ?? offset,
    );
    info.append(detailRow("通知設定", reminderLabels.join("、") || "なし"));
  }
  const reminderSchedule = getCalendarReminderSchedule(event);
  const reminderText = reminderSchedule.length
    ? reminderSchedule
        .map((reminder) => `${formatReminderTime(reminder.scheduledAt)}（${reminder.labels.join("・")}）`)
        .join("、")
    : event.completed
      ? "完了済みのため停止中"
      : "今後の通知予定なし";
  info.append(detailRow("通知予定", reminderText));
  const linkedTodoTitles = event.todoIds
    .map((id) => state.todos.find((todo) => todo.id === id)?.title)
    .filter(Boolean);
  if (linkedTodoTitles.length) {
    info.append(detailRow("関連Todo", linkedTodoTitles.join("、")));
  }

  const completionLabel = document.createElement("label");
  completionLabel.className = "calendar-completion-toggle";
  const completion = document.createElement("input");
  completion.type = "checkbox";
  completion.checked = event.completed;
  completion.disabled = !state.storageReady;
  completion.dataset.action = "complete-calendar-event";
  completion.dataset.eventId = event.id;
  completionLabel.append(completion, document.createTextNode("完了としてチェック（5pt）"));

  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const edit = actionButton("編集", "secondary-button", "edit-calendar-event");
  edit.dataset.eventId = event.id;
  const remove = actionButton("削除", "text-button danger-button", "delete-calendar-event");
  remove.dataset.eventId = event.id;
  actions.append(edit, remove);
  content.append(header, info, completionLabel, actions);
  dialog.append(content);
  return dialog;
}

function detailRow(label, value) {
  const row = document.createElement("div");
  row.className = "calendar-detail-row";
  row.append(make("span", "", label), make("strong", "", value));
  return row;
}

function field(labelText, input, hint = "") {
  const wrapper = make("label", "form-field");
  wrapper.append(make("span", "field-label", labelText), input);
  if (hint) {
    wrapper.append(make("small", "field-hint", hint));
  }
  return wrapper;
}

function textInput(name, value, required = false, id) {
  const input = document.createElement("input");
  input.type = "text";
  input.name = name;
  if (id) {
    input.id = id;
  }
  input.value = value;
  input.maxLength = 160;
  input.required = required;
  return input;
}

function dateInput(name, value) {
  const input = document.createElement("input");
  input.type = "date";
  input.name = name;
  input.value = value;
  input.required = true;
  return input;
}

function timeInput(name, value) {
  const input = document.createElement("input");
  input.type = "time";
  input.name = name;
  input.value = value;
  input.required = true;
  return input;
}

function numberInput(name, value) {
  const input = document.createElement("input");
  input.type = "number";
  input.name = name;
  input.min = "0";
  input.max = "1440";
  input.step = "1";
  input.value = String(value);
  input.required = true;
  return input;
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function submitButton(label) {
  const button = make("button", "primary-button", label);
  button.type = "submit";
  return button;
}

function actionButton(label, className, action) {
  const button = make("button", className, label);
  button.type = "button";
  button.dataset.action = action;
  return button;
}

function formatMonth(monthKey) {
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long" }).format(
    new Date(`${monthKey}-01T00:00:00`),
  );
}

function formatDate(dateKey) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${dateKey}T00:00:00`));
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}
