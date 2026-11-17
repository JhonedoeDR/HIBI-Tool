import { renderSidebar } from "./renderTodoPage.js";

export function renderNotificationPage(state) {
  const shell = document.createElement("div");
  shell.className = "app-layout";
  shell.append(renderSidebar("notifications"));

  const main = document.createElement("main");
  main.className = "main-content";
  const heading = document.createElement("header");
  heading.className = "page-heading";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "REMINDERS";
  const title = document.createElement("h1");
  title.id = "notifications-heading";
  title.textContent = "通知設定";
  const description = document.createElement("p");
  description.className = "page-description";
  description.textContent = "開始日・期限・カレンダーの通知を端末に同期します。";
  heading.append(eyebrow, title, description);
  main.append(heading);

  const card = document.createElement("section");
  card.className = "data-card";
  card.setAttribute("aria-labelledby", "push-notification-heading");
  const cardTitle = document.createElement("h2");
  cardTitle.id = "push-notification-heading";
  cardTitle.textContent = "プッシュ通知";
  const cardDescription = document.createElement("p");
  cardDescription.textContent =
    "初回は通知を許可して端末を登録します。以後のTodoやカレンダーの変更は自動で同期されます。";

  const status = document.createElement("p");
  status.className = "notification-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = getStatusText(state);

  const message = document.createElement("p");
  message.className = state.notificationError ? "error-banner" : "notification-message";
  if (state.notificationError) {
    message.setAttribute("role", "alert");
  } else {
    message.setAttribute("aria-live", "polite");
  }
  message.textContent = state.notificationError || state.notificationMessage;

  const syncButton = document.createElement("button");
  syncButton.className = "primary-button";
  syncButton.type = "button";
  syncButton.dataset.action = "sync-notifications";
  syncButton.disabled = state.notificationSyncing || !state.storageReady;
  syncButton.textContent = state.notificationSyncing
    ? "同期中…"
    : state.notificationSyncEnabled
      ? "今すぐ再同期"
      : "通知を許可して同期";

  card.append(cardTitle, cardDescription, status, message, syncButton);
  main.append(card);
  shell.append(main);
  return shell;
}

function getStatusText(state) {
  if (state.notificationSyncEnabled) {
    return "通知同期は有効です。";
  }
  if (state.notificationPermission === "denied") {
    return "ブラウザーで通知がブロックされています。サイト設定から許可してください。";
  }
  if (state.notificationPermission === "unsupported") {
    return "このブラウザーはWeb Push通知に対応していません。";
  }
  return "通知同期はまだ有効になっていません。";
}
