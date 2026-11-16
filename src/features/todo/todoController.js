import { renderTodoPage } from "../../ui/renderTodoPage.js";
import { renderGamePage } from "../../ui/renderGamePage.js";
import { renderDataPage } from "../../ui/renderDataPage.js";
import { renderCalendarPage } from "../../ui/renderCalendarPage.js";
import { BackupFormatError, createBackupJson, parseBackupJson } from "../data/backupService.js";
import {
  awardCalendarCompletion,
  awardTodoCompletion,
  claimLoginBonus,
  getLoginBonusStatus,
  getMillisecondsUntilJstCutover,
} from "../game/gameService.js";
import {
  CalendarValidationError,
  createCalendarEvent,
  getCurrentMonthKey,
  getLocalDateKey as getCalendarDateKey,
  setCalendarCompletion,
  shiftMonth,
} from "../calendar/calendarService.js";
import {
  createTodo,
  getLocalDateKey,
  getVisibleTodos,
  setChecklistCompletion,
  setTodoCompletion,
  TodoValidationError,
} from "./todoService.js";
import {
  createInitialGameState,
  loadAppState,
  MAX_AUTOMATIC_BACKUPS,
  saveAppState,
  TodoStorageError,
} from "./todoRepository.js";

const CATEGORIES = ["main", "routine", "other"];

export function startTodoApp(root) {
  const state = {
    todos: [],
    game: createInitialGameState(),
    calendarEvents: [],
    backups: [],
    storageReady: true,
    view: "todo",
    calendarMonth: getCurrentMonthKey(),
    calendarDefaultDate: getCalendarDateKey(),
    calendarType: "appointment",
    calendarDialogOpen: false,
    calendarEditingId: null,
    calendarDetailId: null,
    category: "main",
    dueFilter: "all",
    sort: "due",
    selectedIds: new Set(),
    editingId: null,
    dialogOpen: false,
    error: "",
  };
  let loginBonusTimer = null;

  try {
    Object.assign(state, loadAppState());
  } catch (error) {
    if (!(error instanceof TodoStorageError)) {
      throw error;
    }
    state.error = error.message;
    state.storageReady = false;
  }

  function render() {
    if (loginBonusTimer !== null) {
      window.clearTimeout(loginBonusTimer);
      loginBonusTimer = null;
    }
    if (state.view === "game") {
      root.replaceChildren(
        renderGamePage({
          ...state,
          loginBonusStatus: getLoginBonusStatus(state.game.loginBonus),
        }),
      );
      loginBonusTimer = window.setTimeout(() => {
        loginBonusTimer = null;
        render();
      }, getMillisecondsUntilJstCutover() + 50);
      return;
    }
    if (state.view === "data") {
      root.replaceChildren(renderDataPage({ ...state, maxBackups: MAX_AUTOMATIC_BACKUPS }));
      return;
    }
    if (state.view === "calendar") {
      root.replaceChildren(renderCalendarPage(state));
      if (state.calendarDialogOpen) {
        root.querySelector("#calendar-dialog")?.showModal();
        root.querySelector("#calendar-event-title")?.focus();
      }
      if (state.calendarDetailId) {
        root.querySelector("#calendar-details-dialog")?.showModal();
      }
      return;
    }
    const today = getLocalDateKey();
    root.replaceChildren(
      renderTodoPage({
        ...state,
        visibleTodos: getVisibleTodos(state.todos, {
          category: state.category,
          dueFilter: state.dueFilter,
          sort: state.sort,
        }),
        activeCount: state.todos.filter(
          (todo) => !todo.completed && (!todo.dueDate || todo.dueDate >= today),
        ).length,
        dueCount: state.todos.filter((todo) => todo.dueDate && todo.dueDate >= today).length,
      }),
    );
    if (state.dialogOpen) {
      root.querySelector("#todo-dialog")?.showModal();
      root.querySelector("#todo-title")?.focus();
    }
  }

  function persist(nextTodos) {
    persistAppState(nextTodos, state.game);
  }

  function persistAppState(nextTodos, nextGame, nextCalendarEvents = state.calendarEvents) {
    try {
      const savedState = saveAppState({
        todos: nextTodos,
        game: nextGame,
        calendarEvents: nextCalendarEvents,
      });
      state.todos = savedState.todos;
      state.game = savedState.game;
      state.calendarEvents = savedState.calendarEvents;
      state.backups = savedState.backups;
      state.error = "";
      render();
    } catch (error) {
      if (!(error instanceof TodoStorageError)) {
        throw error;
      }
      state.error = error.message;
      render();
    }
  }

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest("button[data-action]");
    if (!button || !root.contains(button)) {
      return;
    }

    const { action, todoId, category, view } = button.dataset;
    if (action === "change-view" && ["todo", "game", "data", "calendar"].includes(view)) {
      state.view = view;
      render();
    } else if (action === "previous-month") {
      state.calendarMonth = shiftMonth(state.calendarMonth, -1);
      render();
    } else if (action === "next-month") {
      state.calendarMonth = shiftMonth(state.calendarMonth, 1);
      render();
    } else if (action === "current-month") {
      state.calendarMonth = getCurrentMonthKey();
      render();
    } else if (action === "new-calendar-event" && state.storageReady) {
      state.calendarEditingId = null;
      state.calendarType = "appointment";
      state.calendarDefaultDate = getCalendarDateKey();
      state.calendarDialogOpen = true;
      state.error = "";
      render();
    } else if (action === "show-calendar-event") {
      if (state.calendarEvents.some((event) => event.id === button.dataset.eventId)) {
        state.calendarDetailId = button.dataset.eventId;
        state.error = "";
        render();
      }
    } else if (action === "edit-calendar-event" && state.storageReady) {
      const event = state.calendarEvents.find((item) => item.id === button.dataset.eventId);
      if (event) {
        state.calendarDetailId = null;
        state.calendarEditingId = event.id;
        state.calendarType = event.type;
        state.calendarDialogOpen = true;
        state.error = "";
        render();
      }
    } else if (action === "delete-calendar-event" && state.storageReady) {
      const event = state.calendarEvents.find((item) => item.id === button.dataset.eventId);
      if (event && window.confirm(`「${event.title}」を削除しますか？`)) {
        state.calendarDetailId = null;
        persistAppState(
          state.todos,
          state.game,
          state.calendarEvents.filter((item) => item.id !== event.id),
        );
      }
    } else if (action === "close-calendar-dialog") {
      state.calendarDialogOpen = false;
      state.calendarEditingId = null;
      state.error = "";
      render();
    } else if (action === "close-calendar-details") {
      state.calendarDetailId = null;
      render();
    } else if (action === "claim-login-bonus" && state.storageReady) {
      const nextGame = claimLoginBonus(state.game);
      if (nextGame !== state.game) {
        persistAppState(state.todos, nextGame);
      }
    } else if (action === "export-backup" && state.storageReady) {
      try {
        downloadBackup(state.todos, state.game, state.calendarEvents);
        state.error = "";
        render();
      } catch (error) {
        state.error = `JSONを書き出せませんでした: ${error.message}`;
        render();
      }
    } else if (action === "restore-backup" && state.storageReady) {
      const backup = state.backups.find((item) => item.id === button.dataset.backupId);
      if (
        backup &&
        window.confirm("現在のTodoとゲームデータを選択したバックアップで全置換しますか？")
      ) {
        persistAppState(backup.data.todos, backup.data.game, backup.data.calendarEvents);
      }
    } else if (action === "change-category" && CATEGORIES.includes(category)) {
      state.category = category;
      state.selectedIds.clear();
      render();
    } else if (action === "new-todo") {
      if (!state.storageReady) {
        return;
      }
      state.editingId = null;
      state.dialogOpen = true;
      state.error = "";
      render();
    } else if (action === "edit-todo" && state.todos.some((todo) => todo.id === todoId)) {
      if (!state.storageReady) {
        return;
      }
      state.editingId = todoId;
      state.dialogOpen = true;
      state.error = "";
      render();
    } else if (
      action === "delete-todo" &&
      state.storageReady &&
      window.confirm("このTodoを削除しますか？")
    ) {
      persist(state.todos.filter((todo) => todo.id !== todoId));
      if (!state.error) {
        state.selectedIds.delete(todoId);
        render();
      }
    } else if (action === "delete-selected" && state.selectedIds.size > 0) {
      if (!state.storageReady) {
        return;
      }
      if (window.confirm(`選択した${state.selectedIds.size}件のTodoを削除しますか？`)) {
        const nextTodos = state.todos.filter((todo) => !state.selectedIds.has(todo.id));
        persist(nextTodos);
        if (!state.error) {
          state.selectedIds.clear();
          render();
        }
      }
    } else if (action === "close-dialog") {
      root.querySelector("#todo-dialog")?.close();
    }
  });

  root.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.dataset.action === "import-backup") {
      const [file] = target.files ?? [];
      target.value = "";
      if (!file || !state.storageReady) {
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        state.error = "JSONバックアップは5MB以下のファイルを選択してください。";
        render();
        return;
      }
      try {
        const data = parseBackupJson(await file.text());
        if (
          window.confirm("現在のTodoとゲームデータを選択したJSONで全置換しますか？")
        ) {
          persistAppState(data.todos, data.game, data.calendarEvents);
        }
      } catch (error) {
        if (!(error instanceof BackupFormatError)) {
          state.error = `JSONファイルを読み込めませんでした: ${error.message}`;
        } else {
          state.error = error.message;
        }
        render();
      }
      return;
    }

    if (target.dataset.action === "calendar-event-type") {
      const form = root.querySelector("#calendar-event-form");
      state.calendarType = target.value;
      if (form) {
        const appointmentFields = form.querySelector("#appointment-fields");
        const deadlineFields = form.querySelector("#deadline-fields");
        appointmentFields.hidden = target.value !== "appointment";
        appointmentFields.disabled = target.value !== "appointment";
        deadlineFields.hidden = target.value !== "deadline";
        deadlineFields.disabled = target.value !== "deadline";
      }
      return;
    }

    if (target.matches("[data-filter]")) {
      if (target.dataset.filter === "due") {
        state.dueFilter = target.value;
      } else if (target.dataset.filter === "sort") {
        state.sort = target.value;
      }
      state.selectedIds.clear();
      render();
      return;
    }

    if (target.dataset.action === "select-todo") {
      if (!state.storageReady) {
        return;
      }
      if (target.checked) {
        state.selectedIds.add(target.dataset.todoId);
      } else {
        state.selectedIds.delete(target.dataset.todoId);
      }
      render();
      return;
    }

    if (target.dataset.action === "complete-todo") {
      if (!state.storageReady) {
        return;
      }
      const currentTodo = state.todos.find((todo) => todo.id === target.dataset.todoId);
      if (!currentTodo) {
        return;
      }
      const completedAt = target.checked ? new Date() : null;
      const nextTodos = setTodoCompletion(
        state.todos,
        target.dataset.todoId,
        target.checked,
        completedAt ?? new Date(),
      );
      const updatedTodo = nextTodos.find((todo) => todo.id === target.dataset.todoId);
      const nextGame =
        target.checked && !currentTodo.completed
          ? awardTodoCompletion(state.game, updatedTodo, updatedTodo.completedAt)
          : state.game;
      persistAppState(nextTodos, nextGame);
    } else if (target.dataset.action === "complete-calendar-event") {
      if (!state.storageReady) {
        return;
      }
      const event = state.calendarEvents.find((item) => item.id === target.dataset.eventId);
      if (!event) {
        return;
      }
      const completedAt = target.checked ? new Date() : null;
      const nextEvents = setCalendarCompletion(
        state.calendarEvents,
        event.id,
        target.checked,
        completedAt ?? new Date(),
      );
      const nextGame =
        target.checked && !event.completed
          ? awardCalendarCompletion(state.game, event)
          : state.game;
      persistAppState(state.todos, nextGame, nextEvents);
    } else if (target.dataset.action === "complete-checklist") {
      if (!state.storageReady) {
        return;
      }
      persist(
        setChecklistCompletion(
          state.todos,
          target.dataset.todoId,
          target.dataset.checklistId,
          target.checked,
        ),
      );
    }
  });

  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    if (form.id === "calendar-event-form") {
      event.preventDefault();
      if (!state.storageReady) {
        return;
      }
      const formData = new FormData(form);
      const editing = state.calendarEvents.find((item) => item.id === state.calendarEditingId);
      const draft = {
        type: String(formData.get("type") ?? ""),
        title: String(formData.get("title") ?? ""),
        date: String(formData.get("date") ?? ""),
        startTime: String(formData.get("startTime") ?? ""),
        travelMinutes: String(formData.get("travelMinutes") ?? ""),
        preparationMinutes: String(formData.get("preparationMinutes") ?? ""),
        arrivalLeadMinutes: String(formData.get("arrivalLeadMinutes") ?? ""),
        location: String(formData.get("location") ?? ""),
        dueTime: String(formData.get("dueTime") ?? ""),
        notificationOffsets: formData.getAll("notificationOffsets").map(String),
      };
      try {
        const nextEvent = createCalendarEvent(draft, {
          id: editing?.id,
          now: new Date(),
        });
        if (editing) {
          nextEvent.createdAt = editing.createdAt;
          nextEvent.completed = editing.completed;
          nextEvent.completedAt = editing.completedAt;
          nextEvent.todoIds = editing.todoIds;
        }
        const nextEvents = editing
          ? state.calendarEvents.map((item) => (item.id === editing.id ? nextEvent : item))
          : [...state.calendarEvents, nextEvent];
        const savedState = saveAppState({
          todos: state.todos,
          game: state.game,
          calendarEvents: nextEvents,
        });
        state.todos = savedState.todos;
        state.game = savedState.game;
        state.calendarEvents = savedState.calendarEvents;
        state.backups = savedState.backups;
        state.calendarDialogOpen = false;
        state.calendarEditingId = null;
        state.error = "";
        render();
      } catch (error) {
        if (!(error instanceof CalendarValidationError || error instanceof TodoStorageError)) {
          throw error;
        }
        state.error = error.message;
        const formError = root.querySelector("#calendar-form-error");
        if (formError) {
          formError.textContent = error.message;
        }
      }
      return;
    }
    if (form.id !== "todo-form") {
      return;
    }
    event.preventDefault();
    if (!state.storageReady) {
      return;
    }
    const formData = new FormData(form);
    const checklistText = String(formData.get("checklist") ?? "");
    const linksText = String(formData.get("links") ?? "");
    const draft = {
      title: String(formData.get("title") ?? ""),
      category: String(formData.get("category") ?? ""),
      startDate: String(formData.get("startDate") ?? ""),
      dueDate: String(formData.get("dueDate") ?? ""),
      checklist: checklistText.split("\n"),
      links: linksText.split("\n").filter((line) => line.trim()),
    };

    try {
      const editing = state.todos.find((todo) => todo.id === state.editingId);
      const nextTodo = createTodo(draft, {
        id: editing?.id,
        now: new Date(),
      });
      if (editing) {
        nextTodo.createdAt = editing.createdAt;
        nextTodo.completed = editing.completed;
        nextTodo.completedAt = editing.completedAt;
        nextTodo.checklist = nextTodo.checklist.map((item, index) => ({
          ...item,
          completed: editing.checklist[index]?.text === item.text
            ? editing.checklist[index].completed
            : false,
        }));
      }
      const nextTodos = editing
        ? state.todos.map((todo) => (todo.id === editing.id ? nextTodo : todo))
        : [...state.todos, nextTodo];
      const savedState = saveAppState({
        todos: nextTodos,
        game: state.game,
        calendarEvents: state.calendarEvents,
      });
      state.todos = savedState.todos;
      state.game = savedState.game;
      state.calendarEvents = savedState.calendarEvents;
      state.backups = savedState.backups;
      state.dialogOpen = false;
      state.editingId = null;
      state.error = "";
      state.storageReady = true;
      render();
    } catch (error) {
      if (!(error instanceof TodoValidationError || error instanceof TodoStorageError)) {
        throw error;
      }
      state.error = error.message;
      const formError = root.querySelector("#todo-form-error");
      if (formError) {
        formError.textContent = error.message;
      }
    }
  });

  root.addEventListener(
    "close",
    (event) => {
      if (!(event.target instanceof HTMLDialogElement)) {
        return;
      }
      if (event.target.id === "todo-dialog") {
        state.dialogOpen = false;
        state.editingId = null;
        if (state.error) {
          render();
        }
      } else if (event.target.id === "calendar-dialog") {
        state.calendarDialogOpen = false;
        state.calendarEditingId = null;
      } else if (event.target.id === "calendar-details-dialog") {
        state.calendarDetailId = null;
      }
    },
    true,
  );

  render();
}

function downloadBackup(todos, game, calendarEvents) {
  const contents = createBackupJson({ todos, game, calendarEvents });
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `daily-tool-backup-${getLocalDateKey()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
