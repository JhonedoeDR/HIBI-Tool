import { renderSidebar } from "./renderTodoPage.js";

export function renderDataPage(state) {
  const shell = document.createElement("div");
  shell.className = "app-layout";
  shell.append(renderSidebar("data"));

  const main = document.createElement("main");
  main.className = "main-content";
  const heading = document.createElement("header");
  heading.className = "page-heading";
  const headingCopy = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "YOUR DATA";
  const title = document.createElement("h1");
  title.id = "data-heading";
  title.textContent = "データ管理";
  const description = document.createElement("p");
  description.className = "page-description";
  description.textContent = "端末内のデータをバックアップ・復元します。";
  headingCopy.append(eyebrow, title, description);
  heading.append(headingCopy);
  main.append(heading);

  if (state.error) {
    const error = document.createElement("p");
    error.className = "error-banner";
    error.setAttribute("role", "alert");
    error.textContent = state.error;
    main.append(error);
  }

  const exportCard = document.createElement("section");
  exportCard.className = "data-card";
  exportCard.setAttribute("aria-labelledby", "json-backup-heading");
  const exportTitle = document.createElement("h2");
  exportTitle.id = "json-backup-heading";
  exportTitle.textContent = "JSONバックアップ";
  const exportDescription = document.createElement("p");
  exportDescription.textContent =
    "Todo、カレンダー、ゲームのデータを書き出します。別の場所に保存して、端末故障やブラウザーデータ消去に備えてください。";
  const exportButton = document.createElement("button");
  exportButton.className = "primary-button";
  exportButton.type = "button";
  exportButton.dataset.action = "export-backup";
  exportButton.disabled = !state.storageReady;
  exportButton.textContent = "JSONを書き出す";

  const importLabel = document.createElement("label");
  importLabel.className = "secondary-button import-backup-label";
  importLabel.textContent = "JSONから全データを復元";
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = "application/json,.json";
  importInput.dataset.action = "import-backup";
  importInput.disabled = !state.storageReady;
  importInput.setAttribute("aria-label", "復元するJSONバックアップを選択");
  importLabel.append(importInput);
  const exportActions = document.createElement("div");
  exportActions.className = "data-actions";
  exportActions.append(exportButton, importLabel);
  exportCard.append(exportTitle, exportDescription, exportActions);

  const automaticCard = document.createElement("section");
  automaticCard.className = "data-card";
  automaticCard.setAttribute("aria-labelledby", "automatic-backup-heading");
  const automaticTitle = document.createElement("h2");
  automaticTitle.id = "automatic-backup-heading";
  automaticTitle.textContent = "自動バックアップ";
  const automaticDescription = document.createElement("p");
  automaticDescription.textContent =
    `データ変更前のTodo、カレンダー、ゲームの状態をアプリ内に最大${state.maxBackups}回分保存します。復元すると現在のデータを全置換します。`;
  automaticCard.append(automaticTitle, automaticDescription);

  if (state.backups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "backup-empty";
    empty.textContent = "まだ自動バックアップはありません。データを変更すると作成されます。";
    automaticCard.append(empty);
  } else {
    const list = document.createElement("ol");
    list.className = "backup-list";
    for (const backup of [...state.backups].reverse()) {
      const item = document.createElement("li");
      item.className = "backup-item";
      const details = document.createElement("div");
      details.className = "backup-details";
      const date = document.createElement("strong");
      date.textContent = formatTimestamp(backup.createdAt);
      const summary = document.createElement("span");
      summary.textContent = `${backup.data.todos.length}件のTodo`;
      details.append(date, summary);

      const restoreButton = document.createElement("button");
      restoreButton.className = "text-button";
      restoreButton.type = "button";
      restoreButton.dataset.action = "restore-backup";
      restoreButton.dataset.backupId = backup.id;
      restoreButton.disabled = !state.storageReady;
      restoreButton.textContent = "復元";
      item.append(details, restoreButton);
      list.append(item);
    }
    automaticCard.append(list);
  }

  const note = document.createElement("p");
  note.className = "game-note data-note";
  note.textContent =
    "自動バックアップも同じ端末内に保存されるため、端末故障やサイトデータ消去への備えにはJSONを外部にも保存してください。";
  main.append(exportCard, automaticCard, note);
  shell.append(main);
  return shell;
}

function formatTimestamp(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
