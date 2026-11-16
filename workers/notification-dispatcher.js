import { createFcmAccessToken, sendFcmNotification } from "../src/features/notifications/fcmClient.js";
import {
  dispatchDueNotifications,
  PushDeliveryError,
} from "../src/features/notifications/notificationDispatcher.js";

export default {
  scheduled(_controller, environment, context) {
    context.waitUntil(runDispatch(environment));
  },
};

async function runDispatch(environment) {
  if (!environment.DB || !environment.FCM_SERVICE_ACCOUNT) {
    throw new Error("通知配信WorkerにD1またはFCM設定がありません。");
  }

  let tokenRequest;
  const result = await dispatchDueNotifications(environment.DB, async (job) => {
    tokenRequest ??= createFcmAccessToken(environment.FCM_SERVICE_ACCOUNT).catch((error) => {
      console.error("FCMアクセストークンの取得に失敗しました。", error);
      throw new PushDeliveryError("fcm_auth_error", { retryable: true });
    });
    const { accessToken, projectId } = await tokenRequest;
    return sendFcmNotification(accessToken, projectId, job);
  });
  console.info("通知配信Workerを実行しました。", result);
  return result;
}
