import { createFcmAccessToken, sendFcmNotification } from "../src/features/notifications/fcmClient.js";
import {
  dispatchDueNotifications,
  pruneExpiredNotificationHistory,
  PushDeliveryError,
} from "../src/features/notifications/notificationDispatcher.js";

export default {
  scheduled(controller, environment, context) {
    if (controller.cron === "0 0 * * *") {
      context.waitUntil(runCleanup(environment, Date.now()));
      return;
    }
    context.waitUntil(runDispatch(environment, Date.now()));
  },
};

async function runDispatch(environment, now) {
  if (!environment.DB || !environment.FCM_SERVICE_ACCOUNT) {
    throw new Error("通知配信WorkerにD1またはFCM設定がありません。");
  }

  let tokenRequest;
  const result = await dispatchDueNotifications(
    environment.DB,
    async (job) => {
      tokenRequest ??= createFcmAccessToken(environment.FCM_SERVICE_ACCOUNT).catch((error) => {
        console.error("FCMアクセストークンの取得に失敗しました。", error);
        throw new PushDeliveryError("fcm_auth_error", { retryable: true });
      });
      const { accessToken, projectId } = await tokenRequest;
      return sendFcmNotification(accessToken, projectId, job);
    },
    now,
  );
  console.info("通知配信Workerを実行しました。", result);
  return result;
}

async function runCleanup(environment, now) {
  if (!environment.DB) {
    throw new Error("通知履歴整理WorkerにD1設定がありません。");
  }

  const pruned = await pruneExpiredNotificationHistory(environment.DB, now);
  console.info("通知履歴を整理しました。", { pruned });
  return { pruned };
}
