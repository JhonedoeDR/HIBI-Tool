import {
  createDefaultRoutineRule,
  getFirstRoutineDate,
  normalizeRoutineRule,
} from "./routineService.js";

export const TODO_CATEGORIES = ["main", "routine", "other"];
export const TODO_CHILD_DISPLAY_MODES = ["all", "sequential", "custom"];

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
  let dueDate = normalizeDate(input.dueDate, "期限");
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
  const childDisplayMode = input.childDisplayMode ?? "all";
  if (!TODO_CHILD_DISPLAY_MODES.includes(childDisplayMode)) {
    throw new TodoValidationError("子Todoの表示方式を選択してください。");
  }
  const childOrder = normalizeChildOrder(input.childOrder, parentId);
  const displayGroup = normalizeDisplayGroup(input.displayGroup, parentId);
  if (!TODO_CATEGORIES.includes(category)) {
    throw new TodoValidationError("分類を選択してください。");
  }
  const routineRule =
    category === "routine"
      ? normalizeRoutineRule(
          input.routineRule ??
            createDefaultRoutineRule(dueDate ?? startDate ?? getLocalDateKey(now)),
        )
      : null;
  if (category === "routine" && !routineRule) {
    throw new TodoValidationError("ルーティン周期の設定が正しくありません。");
  }
  if (category === "routine" && !dueDate) {
    try {
      dueDate = getFirstRoutineDate(routineRule);
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
      throw new TodoValidationError(error.message);
    }
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
    childOrder,
    childDisplayMode,
    displayGroup,
    routineRule,
    routineLastCompletedAt: null,
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

export function getTodoChildren(todos, parentId) {
  return todos
    .filter((todo) => todo.parentId === parentId)
    .sort((left, right) => (left.childOrder ?? Infinity) - (right.childOrder ?? Infinity));
}

export function moveTodoChild(todos, childId, direction, now = new Date()) {
  if (direction !== -1 && direction !== 1) {
    return todos;
  }
  const child = todos.find((todo) => todo.id === childId);
  if (!child?.parentId) {
    return todos;
  }
  const siblings = getTodoChildren(todos, child.parentId);
  const currentIndex = siblings.findIndex((todo) => todo.id === childId);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= siblings.length) {
    return todos;
  }

  const reordered = [...siblings];
  [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
  const orderById = new Map(reordered.map((todo, index) => [todo.id, index]));
  const updatedAt = now.toISOString();
  return todos.map((todo) =>
    orderById.has(todo.id)
      ? { ...todo, childOrder: orderById.get(todo.id), updatedAt }
      : todo,
  );
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
  const todosById = new Map(todos.map((todo) => [todo.id, todo]));
  const activeChildrenByParent = new Map();
  for (const todo of todos) {
    if (todo.dueDate && todo.dueDate < today) {
      continue;
    }
    if (!todo.parentId) {
      continue;
    }
    const children = activeChildrenByParent.get(todo.parentId) ?? [];
    children.push(todo);
    activeChildrenByParent.set(todo.parentId, children);
  }
  for (const children of activeChildrenByParent.values()) {
    children.sort((left, right) => (left.childOrder ?? Infinity) - (right.childOrder ?? Infinity));
  }
  const displayFiltered = filtered.filter((todo) =>
    isVisibleInParentModes(todo, todosById, activeChildrenByParent),
  );

  const sorted = displayFiltered.sort((left, right) => {
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
  const visibleChildrenByParent = new Map();
  for (const todo of sorted) {
    if (!todo.parentId) {
      continue;
    }
    const siblings = visibleChildrenByParent.get(todo.parentId) ?? [];
    siblings.push(todo);
    visibleChildrenByParent.set(todo.parentId, siblings);
  }
  for (const siblings of visibleChildrenByParent.values()) {
    if (siblings.length < 2) {
      continue;
    }
    const orderedChildren = [...siblings].sort(
      (left, right) => (left.childOrder ?? Infinity) - (right.childOrder ?? Infinity),
    );
    const positions = sorted.flatMap((todo, index) =>
      todo.parentId === siblings[0].parentId ? [index] : [],
    );
    positions.forEach((position, index) => {
      sorted[position] = orderedChildren[index];
    });
  }
  return sorted;
}

function isVisibleInParentModes(todo, todosById, activeChildrenByParent) {
  let child = todo;
  let parent = todo.parentId ? todosById.get(todo.parentId) : null;
  while (parent) {
    if (parent.childDisplayMode === "sequential" || parent.childDisplayMode === "custom") {
      const activeChildren = (activeChildrenByParent.get(parent.id) ?? []).filter(
        (item) => !item.completed,
      );
      if (parent.childDisplayMode === "sequential") {
        if (activeChildren[0]?.id !== child.id) {
          return false;
        }
      } else {
        if (child.completed) {
          return false;
        }
        const activeGroup = activeChildren.reduce(
          (group, item) => Math.min(group, item.displayGroup ?? 1),
          Infinity,
        );
        if (activeGroup === Infinity || child.displayGroup !== activeGroup) {
          return false;
        }
      }
    }
    child = parent;
    parent = parent.parentId ? todosById.get(parent.parentId) : null;
  }
  return true;
}

function normalizeChildOrder(value, parentId) {
  if (parentId === null) {
    return null;
  }
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const order = Number(value);
  if (!Number.isSafeInteger(order) || order < 0) {
    throw new TodoValidationError("子Todoの表示順が正しくありません。");
  }
  return order;
}

function normalizeDisplayGroup(value, parentId) {
  if (parentId === null) {
    return null;
  }
  const group = value === undefined || value === "" || value === null ? 1 : Number(value);
  if (!Number.isSafeInteger(group) || group < 1 || group > 100) {
    throw new TodoValidationError("表示グループは1〜100で入力してください。");
  }
  return group;
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
