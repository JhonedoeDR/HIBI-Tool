import { renderTodoPage, updateRoutineFields } from "../../ui/renderTodoPage.js";
import { renderGamePage } from "../../ui/renderGamePage.js";
import { renderDataPage } from "../../ui/renderDataPage.js";
import { renderCalendarPage } from "../../ui/renderCalendarPage.js";
import { renderNotificationPage } from "../../ui/renderNotificationPage.js";
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
  expandTodoSelection,
  getTodoChildren,
  getTodoDescendantIds,
  getLocalDateKey,
  getVisibleTodos,
  moveTodoChild,
  removeTodos,
  setChecklistCompletion,
  setTodoCompletion,
  TodoValidationError,
} from "./todoService.js";
import { advanceMissedRoutineTodos, advanceRoutineTodo } from "./routineService.js";
import {
  disableNotificationSync,
  enableNotificationsAndSync,
  loadNotificationSyncPreference,
  saveNotificationSyncPreference,
  syncNotificationSnapshot,
} from "../notifications/notificationClient.js";
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
    todoDraft: null,
    pendingChildren: [],
    childParentId: null,
    childDialogOpen: false,
    childError: "",
    error: "",
    notificationSyncEnabled: false,
    notificationSyncing: false,
    notificationPermission:
      typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    notificationMessage: "",
    notificationError: "",
  };
  let loginBonusTimer = null;
  let routineRefreshTimer = null;
  let notificationSyncTimer = null;
  let notificationSyncPending = false;

  try {
    state.notificationSyncEnabled = loadNotificationSyncPreference();
  } catch (error) {
    state.notificationError = error.message;
  }

  async function stopNotificationSync() {
    if (notificationSyncTimer !== null) {
      window.clearTimeout(notificationSyncTimer);
      notificationSyncTimer = null;
    }
    state.notificationSyncing = true;
    state.notificationError = "";
    state.notificationMessage = "";
    render();
    try {
      saveNotificationSyncPreference(false);
      state.notificationSyncEnabled = false;
      await disableNotificationSync();
      state.notificationMessage = "この端末への通知配信と自動同期を停止しました。";
    } catch (error) {
      try {
        saveNotificationSyncPreference(true);
        state.notificationSyncEnabled = true;
      } catch (preferenceError) {
        state.notificationSyncEnabled = false;
        state.notificationError =
          `通知設定を端末に保存できませんでした: ${preferenceError.message}`;
      }
      if (!state.notificationError) {
        state.notificationError = error.message;
      }
      state.notificationMessage = "";
    } finally {
      state.notificationSyncing = false;
      render();
    }
  }

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
    scheduleRoutineRefresh();
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
    if (state.view === "notifications") {
      root.replaceChildren(renderNotificationPage(state));
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
    if (state.childDialogOpen) {
      root.querySelector("#child-todo-dialog")?.showModal();
      root.querySelector("#child-todo-title")?.focus();
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
      queueNotificationSync();
    } catch (error) {
      if (!(error instanceof TodoStorageError)) {
        throw error;
      }
      state.error = error.message;
      render();
    }
  }

  function queueNotificationSync(delay = 600) {
    if (!state.notificationSyncEnabled || !state.storageReady) {
      return;
    }
    if (notificationSyncTimer !== null) {
      window.clearTimeout(notificationSyncTimer);
    }
    notificationSyncTimer = window.setTimeout(() => {
      notificationSyncTimer = null;
      void syncNotifications({ showProgress: false });
    }, delay);
  }

  async function syncNotifications({ showProgress = true } = {}) {
    if (state.notificationSyncing) {
      notificationSyncPending = true;
      return;
    }
    const shouldRequestPermission = !state.notificationSyncEnabled;
    state.notificationSyncing = true;
    state.notificationError = "";
    if (showProgress) {
      state.notificationMessage = "";
      render();
    }

    try {
      const data = { todos: state.todos, calendarEvents: state.calendarEvents };
      const result = shouldRequestPermission
        ? await enableNotificationsAndSync(data)
        : await syncNotificationSnapshot(data);
      if (shouldRequestPermission) {
        saveNotificationSyncPreference(true);
        state.notificationSyncEnabled = true;
      }
      state.notificationPermission =
        typeof Notification === "undefined" ? "unsupported" : Notification.permission;
      state.notificationMessage = `${result.scheduledCount}件の通知予定を同期しました。`;
      state.notificationError = "";
    } catch (error) {
      state.notificationError = error.message;
      state.notificationMessage = "";
      state.notificationPermission =
        typeof Notification === "undefined" ? "unsupported" : Notification.permission;
    } finally {
      state.notificationSyncing = false;
      if (showProgress || state.view === "notifications") {
        render();
      }
      if (notificationSyncPending) {
        notificationSyncPending = false;
        queueNotificationSync(0);
      }
    }
  }

  function scheduleRoutineRefresh() {
    if (routineRefreshTimer !== null) {
      window.clearTimeout(routineRefreshTimer);
      routineRefreshTimer = null;
    }
    if (!state.todos.some((todo) => todo.category === "routine" && todo.routineRule)) {
      return;
    }
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    routineRefreshTimer = window.setTimeout(() => {
      routineRefreshTimer = null;
      let refreshedTodos;
      try {
        refreshedTodos = advanceMissedRoutineTodos(state.todos, getLocalDateKey());
      } catch (error) {
        if (!(error instanceof RangeError)) {
          throw error;
        }
        state.error = error.message;
        render();
        return;
      }
      if (refreshedTodos === state.todos) {
        render();
      } else {
        persistAppState(refreshedTodos, state.game);
      }
    }, nextMidnight.getTime() - now.getTime() + 50);
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
    if (
      action === "change-view" &&
      ["todo", "game", "data", "calendar", "notifications"].includes(view)
    ) {
      state.view = view;
      render();
    } else if (action === "sync-notifications" && state.storageReady) {
      void syncNotifications();
    } else if (
      action === "disable-notifications" &&
      state.storageReady &&
      !state.notificationSyncing &&
      window.confirm("この端末への通知配信と自動同期を停止しますか？")
    ) {
      void stopNotificationSync();
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
      state.editingId = crypto.randomUUID();
      state.dialogOpen = true;
      state.todoDraft = null;
      state.pendingChildren = [];
      state.childDialogOpen = false;
      state.childParentId = null;
      state.childError = "";
      state.error = "";
      render();
    } else if (action === "edit-todo" && state.todos.some((todo) => todo.id === todoId)) {
      if (!state.storageReady) {
        return;
      }
      state.editingId = todoId;
      state.dialogOpen = true;
      state.todoDraft = null;
      state.pendingChildren = [];
      state.childDialogOpen = false;
      state.childParentId = null;
      state.childError = "";
      state.error = "";
      render();
    } else if (action === "new-child-todo" && state.storageReady) {
      const form = root.querySelector("#todo-form");
      if (!form || !state.editingId) {
        return;
      }
      state.todoDraft = readTodoDraft(form);
      state.childParentId = state.editingId;
      state.childDialogOpen = true;
      state.childError = "";
      render();
    } else if (action === "close-child-todo") {
      state.childDialogOpen = false;
      state.childParentId = null;
      state.childError = "";
      render();
    } else if (action === "remove-pending-child") {
      const form = root.querySelector("#todo-form");
      if (form) {
        state.todoDraft = readTodoDraft(form);
      }
      state.pendingChildren = state.pendingChildren.filter(
        (todo) => todo.id !== button.dataset.todoId,
      ).map((todo, childOrder) => ({ ...todo, childOrder }));
      render();
    } else if (action === "move-pending-child") {
      const form = root.querySelector("#todo-form");
      if (form) {
        state.todoDraft = readTodoDraft(form);
      }
      const index = state.pendingChildren.findIndex((todo) => todo.id === button.dataset.todoId);
      const nextIndex = index + Number(button.dataset.direction);
      if (index >= 0 && nextIndex >= 0 && nextIndex < state.pendingChildren.length) {
        const children = [...state.pendingChildren];
        [children[index], children[nextIndex]] = [children[nextIndex], children[index]];
        state.pendingChildren = children.map((todo, childOrder) => ({ ...todo, childOrder }));
        render();
      }
    } else if (action === "move-child-order" && state.storageReady) {
      const form = root.querySelector("#todo-form");
      if (form) {
        state.todoDraft = readTodoDraft(form);
      }
      persistAppState(
        moveTodoChild(
          state.todos,
          button.dataset.todoId,
          Number(button.dataset.direction),
        ),
        state.game,
      );
    } else if (
      action === "delete-todo" &&
      state.storageReady &&
      window.confirm("このTodoを削除しますか？")
    ) {
      persistTodoDeletion(new Set([todoId]));
      if (!state.error) {
        state.selectedIds.delete(todoId);
        render();
      }
    } else if (action === "delete-selected" && state.selectedIds.size > 0) {
      if (!state.storageReady) {
        return;
      }
      if (window.confirm(`選択した${state.selectedIds.size}件のTodoを削除しますか？`)) {
        persistTodoDeletion(state.selectedIds);
        if (!state.error) {
          state.selectedIds.clear();
          render();
        }
      }
    } else if (action === "close-dialog") {
      root.querySelector("#todo-dialog")?.close();
    }
  });

  function persistTodoDeletion(deletedIds) {
    const nextTodos = removeTodos(state.todos, deletedIds);
    const nextEvents = state.calendarEvents.map((calendarEvent) => ({
      ...calendarEvent,
      todoIds: calendarEvent.todoIds.filter((id) => !deletedIds.has(id)),
    }));
    persistAppState(nextTodos, state.game, nextEvents);
  }

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

    if (target.name === "routineAnchorDate") {
      target.dataset.preservedAnchor = "true";
      return;
    }

    if (target.name === "startDate" || target.name === "dueDate") {
      const form = target.form;
      const anchor = form?.querySelector('[name="routineAnchorDate"]');
      if (anchor && anchor.dataset.preservedAnchor !== "true") {
        anchor.value =
          form.elements.namedItem("dueDate")?.value ||
          form.elements.namedItem("startDate")?.value ||
          getLocalDateKey();
      }
      return;
    }

    if (target.name === "category" || target.name === "routineType") {
      const form = target.form;
      const section = form?.querySelector("[data-routine-fields]");
      const category = form?.querySelector('[name="category"]')?.value;
      const type = form?.querySelector('[name="routineType"]')?.value;
      updateRoutineFields(section, type, category === "routine");
      if (category === "routine") {
        const details = form?.querySelector(".advanced-fields");
        if (details) {
          details.open = true;
        }
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

    if (target.dataset.action === "calendar-todo-link") {
      const form = root.querySelector("#calendar-event-form");
      if (!form) {
        return;
      }
      const descendantIds = getTodoDescendantIds(state.todos, target.dataset.todoId);
      for (const id of descendantIds) {
        const descendant = [...form.querySelectorAll('[data-action="calendar-todo-link"]')].find(
          (checkbox) => checkbox.dataset.todoId === id,
        );
        if (descendant) {
          descendant.checked = target.checked;
        }
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
      try {
        persistAppState(
          target.checked
            ? advanceRoutineTodo(updatedTodo, nextTodos, completedAt)
            : nextTodos,
          nextGame,
        );
      } catch (error) {
        if (!(error instanceof RangeError)) {
          throw error;
        }
        state.error = error.message;
        render();
      }
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
        todoIds: expandTodoSelection(state.todos, formData.getAll("todoIds").map(String)),
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
        queueNotificationSync();
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
    if (form.id === "child-todo-form") {
      event.preventDefault();
      if (!state.storageReady || !state.childParentId) {
        return;
      }
      const formData = new FormData(form);
      const checklistText = String(formData.get("checklist") ?? "");
      const linksText = String(formData.get("links") ?? "");
      const parent = state.todos.find((todo) => todo.id === state.childParentId);
      const draft = {
        title: String(formData.get("title") ?? ""),
        category: String(formData.get("category") ?? ""),
        childDisplayMode: String(formData.get("childDisplayMode") ?? "all"),
        displayGroup: String(formData.get("displayGroup") ?? ""),
        routineRule:
          String(formData.get("category") ?? "") === "routine" ? readRoutineRule(form) : null,
        startDate: String(formData.get("startDate") ?? ""),
        dueDate: String(formData.get("dueDate") ?? ""),
        checklist: checklistText.split("\n"),
        links: linksText.split("\n").filter((line) => line.trim()),
        parentId: state.childParentId,
      };
      try {
        const childOrder = parent
          ? getTodoChildren(state.todos, parent.id).length
          : state.pendingChildren.length;
        const child = createTodo({ ...draft, childOrder }, { now: new Date() });
        if (parent) {
          const savedState = saveAppState({
            todos: [...state.todos, child],
            game: state.game,
            calendarEvents: state.calendarEvents,
          });
          state.todos = savedState.todos;
          state.game = savedState.game;
          state.calendarEvents = savedState.calendarEvents;
          state.backups = savedState.backups;
        } else {
          state.pendingChildren = [...state.pendingChildren, child];
        }
        state.childDialogOpen = false;
        state.childParentId = null;
        state.childError = "";
        state.error = "";
        render();
        if (parent) {
          queueNotificationSync();
        }
      } catch (error) {
        if (!(error instanceof TodoValidationError || error instanceof TodoStorageError)) {
          throw error;
        }
        state.childError = error.message;
        const formError = root.querySelector("#child-todo-form-error");
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
      childDisplayMode: String(formData.get("childDisplayMode") ?? "all"),
      displayGroup: String(formData.get("displayGroup") ?? ""),
      routineRule:
        String(formData.get("category") ?? "") === "routine" ? readRoutineRule(form) : null,
      startDate: String(formData.get("startDate") ?? ""),
      dueDate: String(formData.get("dueDate") ?? ""),
      checklist: checklistText.split("\n"),
      links: linksText.split("\n").filter((line) => line.trim()),
      parentId: String(formData.get("parentId") ?? ""),
    };

    try {
      const editing = state.todos.find((todo) => todo.id === state.editingId);
      const nextTodo = createTodo(draft, {
        id: editing?.id ?? state.editingId,
        now: new Date(),
      });
      if (editing) {
        if (nextTodo.parentId === editing.parentId) {
          nextTodo.childOrder = editing.childOrder;
        }
        nextTodo.createdAt = editing.createdAt;
        nextTodo.completed = editing.completed;
        nextTodo.completedAt = editing.completedAt;
        nextTodo.routineLastCompletedAt =
          nextTodo.category === "routine" ? editing.routineLastCompletedAt ?? null : null;
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
      nextTodos.push(...state.pendingChildren);
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
      state.todoDraft = null;
      state.pendingChildren = [];
      state.childDialogOpen = false;
      state.childParentId = null;
      state.childError = "";
      state.error = "";
      state.storageReady = true;
      render();
      queueNotificationSync();
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
        state.todoDraft = null;
        state.pendingChildren = [];
        state.childDialogOpen = false;
        state.childParentId = null;
        state.childError = "";
        if (state.error) {
          render();
          if (state.notificationSyncEnabled) {
            queueNotificationSync(0);
          }
        }
      } else if (event.target.id === "calendar-dialog") {
        state.calendarDialogOpen = false;
        state.calendarEditingId = null;
      } else if (event.target.id === "calendar-details-dialog") {
        state.calendarDetailId = null;
      } else if (event.target.id === "child-todo-dialog") {
        state.childDialogOpen = false;
        state.childParentId = null;
        state.childError = "";
      }
    },
    true,
  );

  render();
}

function readTodoDraft(form) {
  const formData = new FormData(form);
  return {
    title: String(formData.get("title") ?? ""),
    category: String(formData.get("category") ?? ""),
    startDate: String(formData.get("startDate") ?? ""),
    dueDate: String(formData.get("dueDate") ?? ""),
    parentId: String(formData.get("parentId") ?? ""),
    childDisplayMode: String(formData.get("childDisplayMode") ?? "all"),
    displayGroup: String(formData.get("displayGroup") ?? ""),
    routineRule:
      String(formData.get("category") ?? "") === "routine" ? readRoutineRule(form) : null,
    checklist: String(formData.get("checklist") ?? ""),
    links: String(formData.get("links") ?? ""),
  };
}

function readRoutineRule(form) {
  const value = (name, fallback = "") =>
    form.elements.namedItem(name)?.value ?? fallback;
  const anchor = form.elements.namedItem("routineAnchorDate");
  const anchorDate =
    anchor?.dataset.preservedAnchor === "true"
      ? anchor.value
      : value("dueDate") || value("startDate") || anchor?.value || getLocalDateKey();
  return {
    type: value("routineType", "daily"),
    anchorDate,
    interval: value("routineInterval", "1"),
    unit: value("routineUnit", "days"),
    day: value("routineDay"),
    month: value("routineMonth"),
    weekday: value("routineWeekday"),
    ordinal: value("routineOrdinal", "1"),
  };
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
