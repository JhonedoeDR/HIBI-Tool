import { bootstrap } from "./app/bootstrap.js";
import { registerNotificationServiceWorker } from "./features/notifications/pushClient.js";

bootstrap(document.querySelector("#app"));
if ("serviceWorker" in navigator) {
  registerNotificationServiceWorker().catch((error) => {
    console.error("通知用Service Workerを登録できませんでした。", error);
  });
}
