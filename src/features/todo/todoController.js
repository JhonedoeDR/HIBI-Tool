import { renderTodoPage } from "../../ui/renderTodoPage.js";
import { renderGamePage } from "../../ui/renderGamePage.js";
import {
  awardTodoCompletion,
  claimLoginBonus,
  getLoginBonusStatus,
  getMillisecondsUntilJstCutover,
} from "../game/gameService.js";
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
  saveAppState,
  TodoStorageError,
} from "./todoRepository.js";

const CATEGORIES = ["main", "routine", "other"];

export function startTodoApp(root) {
  const state = {
    todos: [],
    game: createInitialGameState(),
    storageReady: true,
    view: "todo",
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

  function persistAppState(nextTodos, nextGame) {
    try {
      saveAppState({ todos: nextTodos, game: nextGame });
      state.todos = nextTodos;
      state.game = nextGame;
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
    if (action === "change-view" && (view === "todo" || view === "game")) {
      state.view = view;
      render();
    } else if (action === "claim-login-bonus" && state.storageReady) {
      const nextGame = claimLoginBonus(state.game);
      if (nextGame !== state.game) {
        persistAppState(state.todos, nextGame);
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

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
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
    if (!(form instanceof HTMLFormElement) || form.id !== "todo-form") {
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
      saveAppState({ todos: nextTodos, game: state.game });
      state.todos = nextTodos;
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
      if (event.target instanceof HTMLDialogElement && event.target.id === "todo-dialog") {
        state.dialogOpen = false;
        state.editingId = null;
        if (state.error) {
          render();
        }
      }
    },
    true,
  );

  render();
}
