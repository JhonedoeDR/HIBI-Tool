export function renderDashboard(features) {
  const shell = document.createElement("div");
  shell.className = "app-shell";

  const header = document.createElement("header");
  header.className = "app-header";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Personal life & game companion";

  const title = document.createElement("h1");
  title.textContent = "Daily-tool";

  const intro = document.createElement("p");
  intro.className = "app-intro";
  intro.textContent =
    "日々の管理をゲームの進行につなげる、個人向けツールです。機能ごとに分けて、段階的に開発します。";

  header.append(eyebrow, title, intro);

  const section = document.createElement("section");
  section.setAttribute("aria-labelledby", "features-heading");

  const sectionHeading = document.createElement("div");
  sectionHeading.className = "section-heading";

  const heading = document.createElement("h2");
  heading.id = "features-heading";
  heading.textContent = "機能";

  const status = document.createElement("p");
  status.textContent = "基本構造を作成しました。各機能は準備中です。";
  sectionHeading.append(heading, status);

  const grid = document.createElement("div");
  grid.className = "feature-grid";

  for (const feature of features) {
    const card = document.createElement("article");
    card.className = "feature-card";

    const cardTitle = document.createElement("h3");
    cardTitle.textContent = feature.title;

    const description = document.createElement("p");
    description.textContent = feature.description;

    const badge = document.createElement("span");
    badge.className = "feature-status";
    badge.textContent = "準備中";

    card.append(cardTitle, description, badge);
    grid.append(card);
  }

  section.append(sectionHeading, grid);

  const footer = document.createElement("footer");
  footer.className = "app-footer";
  footer.textContent =
    "現時点では画面の骨格のみです。データ保存や外部サービス連携はまだ行いません。";

  shell.append(header, section, footer);
  return shell;
}
