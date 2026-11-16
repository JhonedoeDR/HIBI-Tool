import { featureCatalog } from "../features/featureCatalog.js";
import { renderDashboard } from "../ui/renderDashboard.js";

export function bootstrap(root) {
  if (!(root instanceof HTMLElement)) {
    throw new Error("アプリの表示先要素が見つかりません。");
  }

  root.replaceChildren(renderDashboard(featureCatalog));
}
