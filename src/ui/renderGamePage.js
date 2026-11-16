import { renderSidebar } from "./renderTodoPage.js";
import { gameAssets } from "../assets/assetManifest.js";

export function renderGamePage(state) {
  const shell = document.createElement("div");
  shell.className = "app-layout";
  shell.append(renderSidebar("game"));

  const main = document.createElement("main");
  main.className = "main-content";
  const page = document.createElement("section");
  page.className = "game-page";
  page.setAttribute("aria-labelledby", "game-heading");

  const heading = document.createElement("header");
  heading.className = "page-heading game-heading";
  const copy = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "LIFE × ADVENTURE";
  const title = document.createElement("h1");
  title.id = "game-heading";
  title.textContent = "冒険";
  const description = document.createElement("p");
  description.className = "page-description";
  description.textContent = "Todoの完了で得たポイントを、ゲーム進行に使います。";
  copy.append(eyebrow, title, description);
  heading.append(copy);

  if (!state.storageReady) {
    main.append(heading);
    const error = document.createElement("p");
    error.className = "error-banner";
    error.setAttribute("role", "alert");
    error.textContent = state.error;
    main.append(error);
    shell.append(main);
    return shell;
  }

  const error = state.error ? document.createElement("p") : null;
  if (error) {
    error.className = "error-banner";
    error.setAttribute("role", "alert");
    error.textContent = state.error;
  }

  const balanceHeading = document.createElement("h2");
  balanceHeading.className = "game-section-title";
  balanceHeading.textContent = "所持ポイント";

  const balances = document.createElement("div");
  balances.className = "game-balance-grid";
  balances.append(
    balanceCard("通常ポイント", state.game.normalPoints, "todo"),
    balanceCard("攻撃専用ポイント", state.game.attackPoints, "attack", gameAssets.sword),
    balanceCard("ジュエル", state.game.jewels, "jewel", gameAssets.jewel),
  );

  const loginBonus = renderLoginBonus(state.loginBonusStatus, state.storageReady);
  const route = document.createElement("section");
  route.className = "game-route-card";
  route.setAttribute("aria-labelledby", "route-heading");

  const routeHeader = document.createElement("div");
  routeHeader.className = "game-route-header";
  const routeCopy = document.createElement("div");
  const routeEyebrow = document.createElement("p");
  routeEyebrow.className = "eyebrow";
  routeEyebrow.textContent = "MAIN ROUTE";
  const routeTitle = document.createElement("h2");
  routeTitle.id = "route-heading";
  routeTitle.textContent = `平原エリア ${state.game.area}`;
  routeCopy.append(routeEyebrow, routeTitle);

  const progress = document.createElement("span");
  progress.className = "route-progress";
  progress.textContent = `マス ${state.game.position + 1}`;
  routeHeader.append(routeCopy, progress);

  const landscape = document.createElement("div");
  landscape.className = "game-landscape";
  const landscapeImage = document.createElement("img");
  landscapeImage.className = "game-landscape-image";
  landscapeImage.src = gameAssets.areaBackground;
  landscapeImage.alt = "平原エリア";
  landscapeImage.width = 1920;
  landscapeImage.height = 1080;
  landscapeImage.loading = "lazy";
  landscapeImage.decoding = "async";

  const path = document.createElement("div");
  path.className = "route-track";
  path.setAttribute("aria-label", "エリアの一本道ルート");
  for (let index = 0; index < 5; index += 1) {
    const tile = document.createElement("span");
    tile.className = `route-tile${index === state.game.position % 5 ? " is-current" : ""}`;
    tile.textContent = index === 4 ? "B" : String(index + 1);
    path.append(tile);
  }

  const unavailable = document.createElement("p");
  unavailable.className = "game-note";
  unavailable.textContent =
    "戦闘、マス数、敵HP、報酬計算は仕様が未確定のため、ポイント表示のみ実装しています。";

  landscape.append(landscapeImage, path);
  route.append(routeHeader, landscape, unavailable);

  const info = document.createElement("p");
  info.className = "game-note game-storage-note";
  info.textContent =
    "ポイントはTodo完了時に一度だけ付与されます。完了を取り消しても、付与済みポイントは減りません。";

  page.append(heading);
  if (error) {
    page.append(error);
  }
  page.append(balanceHeading, balances, loginBonus, route, info);
  main.append(page);
  shell.append(main);
  return shell;
}

function renderLoginBonus(status, storageReady) {
  const card = document.createElement("section");
  card.className = "login-bonus-card";
  card.setAttribute("aria-labelledby", "login-bonus-heading");

  const content = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "DAILY BONUS";
  const heading = document.createElement("h2");
  heading.id = "login-bonus-heading";
  heading.textContent = `累積ログイン ${status.rewardDay}日目`;
  const reward = document.createElement("p");
  reward.className = "login-bonus-reward";
  reward.textContent =
    status.reward.type === "jewels"
      ? `${status.reward.amount} ジュエル`
      : `攻撃専用ポイント ${status.reward.amount}pt`;
  content.append(eyebrow, heading, reward);

  const claimButton = document.createElement("button");
  claimButton.className = "primary-button";
  claimButton.type = "button";
  claimButton.dataset.action = "claim-login-bonus";
  claimButton.disabled = !storageReady || !status.canClaim;
  claimButton.textContent = status.canClaim
    ? "報酬を受け取る"
    : "本日分は受取済み";

  const note = document.createElement("p");
  note.className = "game-note";
  note.textContent = "日付は日本時間の午前4時に切り替わります。未受取報酬は失効しますが、累積日数は保持されます。";

  card.append(content, claimButton, note);
  return card;
}

function balanceCard(label, value, type, iconPath) {
  const card = document.createElement("article");
  card.className = `game-balance-card game-balance-${type}`;
  if (iconPath) {
    const icon = document.createElement("img");
    icon.className = "game-balance-icon";
    icon.src = iconPath;
    icon.alt = "";
    icon.width = 36;
    icon.height = 36;
    icon.loading = "lazy";
    icon.decoding = "async";
    card.append(icon);
  }
  const name = document.createElement("span");
  name.className = "game-balance-label";
  name.textContent = label;
  const amount = document.createElement("strong");
  amount.className = "game-balance-value";
  amount.textContent = value.toLocaleString("ja-JP");
  card.append(name, amount);
  return card;
}
