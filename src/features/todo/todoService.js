export const TODO_CATEGORIES = ["main", "routine", "other"];

const CATEGORY_LABELS = {
  main: "メイン",
  routine: "ルーティン",
  other: "その他",
};

export class TodoValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TodoValidationError";
  }
}

export function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] ?? "不明";
}

export function createTodo(input, { id = crypto.randomUUID(), now = new Date() } = {}) {
  const title = input.title.trim();
  const category = input.category;
  const startDate = normalizeDate(input.startDate, "開始日");
  const dueDate = normalizeDate(input.dueDate, "期限");
  const parentId =
    input.parentId === "" || input.parentId === undefined || input.parentId === null
      ? null
      : input.parentId;

  if (!title) {
    throw new TodoValidationError("タスク名を入力してください。");
  }
  if (parentId !== null && (typeof parentId !== "string" || parentId === id)) {
    throw new TodoValidationError("親Todoの指定が正しくありません。");
  }
  if (!TODO_CATEGORIES.includes(category)) {
    throw new TodoValidationError("分類を選択してください。");
  }
  if (startDate && dueDate && startDate > dueDate) {
    throw new TodoValidationError("開始日は期限以前の日付にしてください。");
  }

  const checklist = (input.checklist ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .map((text) => ({ id: crypto.randomUUID(), text, completed: false }));
  const links = (input.links ?? []).map(normalizeLink);
  const timestamp = now.toISOString();

  return {
    id,
    title,
    category,
    startDate,
    dueDate,
    parentId,
    checklist,
    links,
    completed: false,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function getTodoDescendantIds(todos, parentId) {
  if (typeof parentId !== "string" || !parentId) {
    return [];
  }
  const visited = new Set([parentId]);
  const descendants = [];
  const queue = [parentId];

  while (queue.length) {
    const currentId = queue.shift();
    for (const todo of todos) {
      if (todo.parentId === currentId && !visited.has(todo.id)) {
        visited.add(todo.id);
        descendants.push(todo.id);
        queue.push(todo.id);
      }
    }
  }

  return descendants;
}

export function expandTodoSelection(todos, todoIds) {
  const selectedIds = new Set(todoIds.filter((id) => todos.some((todo) => todo.id === id)));
  for (const id of [...selectedIds]) {
    for (const descendantId of getTodoDescendantIds(todos, id)) {
      selectedIds.add(descendantId);
    }
  }
  return todos.filter((todo) => selectedIds.has(todo.id)).map((todo) => todo.id);
}

export function removeTodos(todos, todoIds) {
  const deletedIds = new Set(todoIds);
  return todos
    .filter((todo) => !deletedIds.has(todo.id))
    .map((todo) =>
      deletedIds.has(todo.parentId) ? { ...todo, parentId: null } : todo,
    );
}

export function setTodoCompletion(todos, id, completed, now = new Date()) {
  return todos.map((todo) => {
    if (todo.id !== id || todo.completed === completed) {
      return todo;
    }

    return {
      ...todo,
      completed,
      completedAt: completed ? now.toISOString() : null,
      updatedAt: now.toISOString(),
    };
  });
}

export function setChecklistCompletion(todos, todoId, checklistId, completed, now = new Date()) {
  return todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    return {
      ...todo,
      checklist: todo.checklist.map((item) =>
        item.id === checklistId ? { ...item, completed } : item,
      ),
      updatedAt: now.toISOString(),
    };
  });
}

export function getVisibleTodos(
  todos,
  { category = "main", dueFilter = "all", sort = "due", today = getLocalDateKey() } = {},
) {
  const filtered = todos.filter((todo) => {
    if (todo.dueDate && todo.dueDate < today) {
      return false;
    }
    if (category !== "all" && todo.category !== category) {
      return false;
    }
    if (dueFilter === "with-due" && !todo.dueDate) {
      return false;
    }
    if (dueFilter === "without-due" && todo.dueDate) {
      return false;
    }
    return true;
  });

  return filtered.sort((left, right) => {
    const leftNotStarted = left.startDate && left.startDate > today;
    const rightNotStarted = right.startDate && right.startDate > today;
    if (Boolean(leftNotStarted) !== Boolean(rightNotStarted)) {
      return leftNotStarted ? 1 : -1;
    }

    if (sort === "name") {
      return left.title.localeCompare(right.title, "ja");
    }

    if (!left.dueDate && right.dueDate) {
      return 1;
    }
    if (left.dueDate && !right.dueDate) {
      return -1;
    }
    if (left.dueDate !== right.dueDate) {
      return (left.dueDate ?? "").localeCompare(right.dueDate ?? "");
    }
    return left.title.localeCompare(right.title, "ja");
  });
}

export function pruneExpiredTodos(todos, today = getLocalDateKey()) {
  const todayValue = dateOrdinal(today);
  return todos.filter((todo) => !todo.dueDate || todayValue - dateOrdinal(todo.dueDate) <= 7);
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDate(value, label) {
  if (value === "" || value == null) {
    return null;
  }
  if (!isDateKey(value)) {
    throw new TodoValidationError(`${label}の日付が正しくありません。`);
  }
  return value;
}

function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function dateOrdinal(value) {
  if (!isDateKey(value)) {
    throw new TodoValidationError("保存されたTodoの日付が正しくありません。");
  }
  return Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
}

function normalizeLink(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TodoValidationError(`リンクのURLが正しくありません: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TodoValidationError("リンクには http または https のURLを指定してください。");
  }
  return url.href;
}
