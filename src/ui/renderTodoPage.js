import {
  getCategoryLabel,
  getTodoDescendantIds,
  getLocalDateKey,
} from "../features/todo/todoService.js";

const CATEGORY_OPTIONS = [
  ["main", "メイン"],
  ["routine", "ルーティン"],
  ["other", "その他"],
];

export function renderTodoPage(state) {
  const shell = element("div", "app-layout");
  shell.append(renderSidebar(state.view));

  const main = element("main", "main-content");
  main.append(renderTopbar(), renderHeading(state), renderSummary(state));
  main.append(renderTodoSection(state));
  main.append(renderFooter());
  shell.append(main, renderTodoDialog(state));
  return shell;
}

export function renderSidebar(view = "todo") {
  const sidebar = element("aside", "sidebar");
  const brand = element("a", "brand", undefined, { href: "./", "aria-label": "Daily-tool ホーム" });
  brand.append(element("span", "brand-mark", "D"));
  const brandText = element("span", "brand-copy");
  brandText.append(element("strong", "", "Daily-tool"), element("small", "", "LIFE × GAME"));
  brand.append(brandText);

  const navigation = element("nav", "primary-nav");
  navigation.setAttribute("aria-label", "メインメニュー");
  navigation.append(
    navButton("✓", "Todo", "todo", view),
    navButton("▦", "カレンダー", "calendar", view),
    navButton("◇", "ゲーム", "game", view),
    navButton("▣", "武器・アイテム"),
    navButton("⚙", "データ管理", "data", view),
  );

  const profile = element("div", "sidebar-profile");
  profile.append(element("span", "profile-avatar", "P"));
  const profileText = element("span", "profile-copy");
  profileText.append(element("strong", "", "Personal"), element("small", "", "端末内に保存"));
  profile.append(profileText);
  sidebar.append(brand, navigation, profile);
  return sidebar;
}

function navButton(symbol, label, view, currentView) {
  const active = Boolean(view && view === currentView);
  const button = element("button", `nav-item${active ? " is-active" : ""}`);
  button.type = "button";
  button.disabled = !view;
  if (view) {
    button.dataset.action = "change-view";
    button.dataset.view = view;
  }
  button.setAttribute("aria-current", active ? "page" : "false");
  button.append(element("span", "nav-symbol", symbol), element("span", "", label));
  return button;
}

function renderTopbar() {
  const topbar = element("div", "topbar");
  const today = new Date();
  const dateText = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(today);
  topbar.append(
    element("span", "topbar-context", "マイワークスペース"),
    element("span", "topbar-date", dateText),
  );
  return topbar;
}

function renderHeading(state) {
  const heading = element("header", "page-heading");
  const copy = element("div", "");
  copy.append(
    element("p", "eyebrow", "YOUR DAILY FLOW"),
    element("h1", "", "Todo"),
    element("p", "page-description", "小さな一歩を、今日の前進に。"),
  );
  const addButton = actionButton("＋ Todoを追加", "primary-button", "new-todo");
  addButton.disabled = !state.storageReady;
  heading.append(copy, addButton);
  return heading;
}

function renderSummary(state) {
  const summary = element("section", "summary-grid");
  summary.setAttribute("aria-label", "Todoの概要");
  summary.append(
    summaryCard("未完了", String(state.activeCount), "件のタスク"),
    summaryCard("期限あり", String(state.dueCount), "件のタスク"),
    summaryCard("今日の日付", getLocalDateKey().replaceAll("-", "."), "ローカル時間"),
  );
  return summary;
}

function summaryCard(label, value, note) {
  const card = element("article", "summary-card");
  card.append(
    element("span", "summary-label", label),
    element("strong", "summary-value", value),
    element("span", "summary-note", note),
  );
  return card;
}

function renderTodoSection(state) {
  const section = element("section", "todo-panel");
  section.setAttribute("aria-labelledby", "todo-list-heading");

  const panelHeader = element("div", "todo-panel-header");
  const heading = element("div", "panel-title");
  const listHeading = element("h2", "", "タスク一覧");
  listHeading.id = "todo-list-heading";
  heading.append(listHeading, element("p", "", `${state.visibleTodos.length}件を表示中`));

  const controls = element("div", "list-controls");
  controls.append(
    labeledSelect("期限", "due", state.dueFilter, [
      ["all", "すべて"],
      ["with-due", "期限あり"],
      ["without-due", "期限なし"],
    ]),
    labeledSelect("並び替え", "sort", state.sort, [
      ["due", "期限順"],
      ["name", "名前順"],
    ]),
  );
  panelHeader.append(heading, controls);

  const tabs = element("div", "category-tabs");
  tabs.setAttribute("aria-label", "Todoの分類");
  for (const [category, label] of CATEGORY_OPTIONS) {
    const tab = actionButton(label, `category-tab${state.category === category ? " is-active" : ""}`, "change-category");
    tab.dataset.category = category;
    tab.setAttribute("aria-pressed", String(state.category === category));
    tabs.append(tab);
  }
  panelHeader.append(tabs);

  if (state.error) {
    const error = element("p", "error-banner", state.error);
    error.setAttribute("role", "alert");
    section.append(error);
  }

  const toolbar = element("div", "selection-toolbar");
  const selectedLabel = element("span", "selection-count", `${state.selectedIds.size}件を選択中`);
  const deleteSelected = actionButton("選択を削除", "text-button danger-button", "delete-selected");
  deleteSelected.disabled = state.selectedIds.size === 0 || !state.storageReady;
  toolbar.append(selectedLabel, deleteSelected);

  const list = element("div", "todo-list");
  if (state.visibleTodos.length === 0) {
    const empty = element("div", "empty-state");
    empty.append(
      element("span", "empty-mark", "✓"),
      element("h3", "", state.error ? "Todoデータを利用できません" : "Todoはまだありません"),
      element(
        "p",
        "",
        state.error
          ? "保存データを保護するため、読み込みに成功するまで変更を無効にしています。"
          : "最初のタスクを追加して、今日の予定を整理しましょう。",
      ),
    );
    if (state.storageReady) {
      empty.append(actionButton("Todoを追加する", "secondary-button", "new-todo"));
    }
    list.append(empty);
  } else {
    for (const todo of state.visibleTodos) {
      list.append(renderTodo(todo, state));
    }
  }

  section.append(panelHeader, toolbar, list);
  return section;
}

function labeledSelect(label, filter, value, options) {
  const wrapper = element("label", "select-control");
  wrapper.append(element("span", "", label));
  const select = element("select", "");
  select.dataset.filter = filter;
  for (const [optionValue, optionLabel] of options) {
    const option = element("option", "", optionLabel);
    option.value = optionValue;
    select.append(option);
  }
  select.value = value;
  wrapper.append(select);
  return wrapper;
}

function renderTodo(todo, state) {
  const notStarted = todo.startDate && todo.startDate > getLocalDateKey();
  const item = element(
    "article",
    `todo-item${todo.completed ? " is-completed" : ""}${notStarted ? " is-not-started" : ""}`,
  );
  const selection = element("input", "selection-checkbox");
  selection.type = "checkbox";
  selection.disabled = !state.storageReady;
  selection.checked = state.selectedIds.has(todo.id);
  selection.dataset.action = "select-todo";
  selection.dataset.todoId = todo.id;
  selection.setAttribute("aria-label", `${todo.title}を選択`);

  const completion = element("input", "completion-checkbox");
  completion.type = "checkbox";
  completion.disabled = !state.storageReady;
  completion.checked = todo.completed;
  completion.dataset.action = "complete-todo";
  completion.dataset.todoId = todo.id;
  completion.setAttribute("aria-label", `${todo.title}を完了にする`);

  const copy = element("div", "todo-copy");
  const titleRow = element("div", "todo-title-row");
  titleRow.append(
    element("h3", "todo-title", todo.title),
    element("span", "todo-category", getCategoryLabel(todo.category)),
  );
  copy.append(titleRow, renderTodoMeta(todo, notStarted));
  const parent = state.todos.find((item) => item.id === todo.parentId);
  const children = state.todos.filter((item) => item.parentId === todo.id);
  if (parent || children.length) {
    copy.append(renderTodoRelations(parent, children));
  }
  if (todo.checklist.length) {
    copy.append(renderChecklist(todo, state));
  }
  if (todo.links.length) {
    copy.append(renderLinks(todo));
  }

  const actions = element("div", "todo-actions");
  const edit = actionButton("編集", "icon-button", "edit-todo");
  edit.disabled = !state.storageReady;
  edit.dataset.todoId = todo.id;
  edit.setAttribute("aria-label", `${todo.title}を編集`);
  const remove = actionButton("削除", "icon-button danger-button", "delete-todo");
  remove.disabled = !state.storageReady;
  remove.dataset.todoId = todo.id;
  remove.setAttribute("aria-label", `${todo.title}を削除`);
  actions.append(edit, remove);

  item.append(selection, completion, copy, actions);
  return item;
}

function renderTodoMeta(todo, notStarted) {
  const meta = element("div", "todo-meta");
  if (notStarted) {
    meta.append(element("span", "start-status", "開始前"));
  }
  if (todo.startDate) {
    meta.append(element("span", "", `開始 ${formatDate(todo.startDate)}`));
  }
  if (todo.dueDate) {
    meta.append(element("span", "", `期限 ${formatDate(todo.dueDate)}`));
  } else {
    meta.append(element("span", "", "期限なし"));
  }
  return meta;
}

function renderTodoRelations(parent, children) {
  const relations = element("div", "todo-relations");
  if (parent) {
    relations.append(element("span", "", `親Todo: ${parent.title}`));
  }
  if (children.length) {
    relations.append(
      element("span", "", `子Todo: ${children.map((child) => child.title).join("、")}`),
    );
  }
  return relations;
}

function renderChecklist(todo, state) {
  const list = element("ul", "checklist");
  for (const entry of todo.checklist) {
    const row = element("li", "checklist-row");
    const checkbox = element("input", "");
    checkbox.type = "checkbox";
    checkbox.disabled = !state.storageReady;
    checkbox.checked = entry.completed;
    checkbox.dataset.action = "complete-checklist";
    checkbox.dataset.todoId = todo.id;
    checkbox.dataset.checklistId = entry.id;
    checkbox.setAttribute("aria-label", `${entry.text}を完了にする`);
    row.append(checkbox, element("span", entry.completed ? "is-checked" : "", entry.text));
    list.append(row);
  }
  return list;
}

function renderLinks(todo) {
  const links = element("ul", "todo-links");
  for (const url of todo.links) {
    const link = element("a", "", new URL(url).hostname);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = url;
    const item = element("li", "");
    item.append(link);
    links.append(item);
  }
  return links;
}

function renderTodoDialog(state) {
  const todo = state.todos.find((item) => item.id === state.editingId);
  const dialog = element("dialog", "todo-dialog");
  dialog.id = "todo-dialog";
  dialog.setAttribute("aria-labelledby", "todo-dialog-title");
  const form = element("form", "todo-form");
  form.id = "todo-form";

  const header = element("div", "dialog-header");
  const titleCopy = element("div", "");
  titleCopy.append(
    element("p", "eyebrow", "TASK DETAILS"),
    element("h2", "", todo ? "Todoを編集" : "新しいTodo"),
  );
  header.append(titleCopy);
  const closeButton = actionButton("×", "dialog-close", "close-dialog");
  closeButton.disabled = !state.storageReady;
  closeButton.setAttribute("aria-label", "閉じる");
  header.append(closeButton);

  const fields = element("div", "form-fields");
  fields.append(
    field("タスク名", textInput("title", todo?.title ?? "", "todo-title", true)),
    field("分類", categorySelect(todo?.category ?? state.category)),
  );

  const dateFields = element("div", "form-fields two-columns");
  dateFields.append(
    field("開始日（任意）", dateInput("startDate", todo?.startDate ?? "")),
    field("期限終了日（任意）", dateInput("dueDate", todo?.dueDate ?? "")),
  );

  const details = element("details", "advanced-fields");
  details.append(element("summary", "", "詳細設定（親Todo・チェックリスト・リンク）"));
  details.append(parentTodoField(todo, state.todos));
  const checklist = element("textarea", "");
  checklist.name = "checklist";
  checklist.rows = 3;
  checklist.placeholder = "項目を1行ずつ入力";
  checklist.value = (todo?.checklist ?? []).map((item) => item.text).join("\n");
  details.append(field("チェックリスト", checklist, "1行につき1項目"));

  const links = element("textarea", "");
  links.name = "links";
  links.rows = 2;
  links.placeholder = "https://example.com";
  links.value = (todo?.links ?? []).join("\n");
  details.append(field("リンク（複数可）", links, "http または https のURLを1行ずつ入力"));

  const error = element("p", "form-error", state.error);
  error.id = "todo-form-error";
  error.setAttribute("role", "alert");

  const footer = element("div", "dialog-actions");
  const cancel = actionButton("キャンセル", "secondary-button", "close-dialog");
  cancel.disabled = !state.storageReady;
  const submit = element("button", "primary-button", todo ? "変更を保存" : "Todoを追加");
  submit.type = "submit";
  submit.disabled = !state.storageReady;
  footer.append(cancel, submit);

  form.append(header, fields, dateFields, details, error, footer);
  dialog.append(form);
  return dialog;
}

function parentTodoField(todo, todos) {
  const select = element("select", "");
  select.name = "parentId";
  const noParent = element("option", "", "なし（親Todo）");
  noParent.value = "";
  select.append(noParent);

  const excludedIds = new Set(
    todo ? [todo.id, ...getTodoDescendantIds(todos, todo.id)] : [],
  );
  const availableTodos = [...todos]
    .filter((item) => !excludedIds.has(item.id))
    .sort((left, right) => left.title.localeCompare(right.title, "ja"));
  for (const candidate of availableTodos) {
    const parent = todos.find((item) => item.id === candidate.parentId);
    const option = element(
      "option",
      "",
      parent ? `${parent.title} › ${candidate.title}` : candidate.title,
    );
    option.value = candidate.id;
    select.append(option);
  }
  select.value = todo?.parentId ?? "";
  return field("親Todo（任意）", select, "選択したTodoの子タスクとして紐付けます。");
}

function field(labelText, input, hint = "") {
  const wrapper = element("label", "form-field");
  wrapper.append(element("span", "field-label", labelText), input);
  if (hint) {
    wrapper.append(element("small", "field-hint", hint));
  }
  return wrapper;
}

function textInput(name, value, id, required = false) {
  const input = element("input", "");
  input.type = "text";
  input.name = name;
  input.id = id;
  input.value = value;
  input.maxLength = 160;
  input.required = required;
  return input;
}

function dateInput(name, value) {
  const input = element("input", "");
  input.type = "date";
  input.name = name;
  input.value = value ?? "";
  return input;
}

function categorySelect(value) {
  const select = element("select", "");
  select.name = "category";
  for (const [category, label] of CATEGORY_OPTIONS) {
    const option = element("option", "", label);
    option.value = category;
    select.append(option);
  }
  select.value = value;
  return select;
}

function renderFooter() {
  return element("footer", "app-footer", "データはこのブラウザーの端末内に保存されます。JSONバックアップ機能は未実装です。");
}

function actionButton(text, className, action) {
  const button = element("button", className, text);
  button.type = "button";
  button.dataset.action = action;
  return button;
}

function element(tagName, className, text, attributes = {}) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  return node;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}
