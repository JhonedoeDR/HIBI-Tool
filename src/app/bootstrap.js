import { startTodoApp } from "../features/todo/todoController.js";

export function bootstrap(root) {
  if (!(root instanceof HTMLElement)) {
    throw new Error("アプリの表示先要素が見つかりません。");
  }

  startTodoApp(root);
}
