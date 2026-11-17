import {
  appCheckRecaptchaSiteKey,
  firebaseConfig,
  vapidPublicKey,
} from "./firebaseConfig.js";
import { createNotificationSyncPayload } from "./notificationSyncService.js";
import { registerNotificationServiceWorker } from "./pushClient.js";

const FIREBASE_SDK_VERSION = "13.4.0";
export const NOTIFICATION_SYNC_STORAGE_KEY = "daily-tool.notifications.sync-enabled.v1";
let appCheckInstance;

export class NotificationClientError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "NotificationClientError";
  }
}

export function loadNotificationSyncPreference(storage = globalThis.localStorage) {
  try {
    return storage.getItem(NOTIFICATION_SYNC_STORAGE_KEY) === "true";
  } catch (cause) {
    throw new NotificationClientError("通知設定を端末から読み込めませんでした。", {
      cause,
    });
  }
}

export function saveNotificationSyncPreference(
  enabled,
  storage = globalThis.localStorage,
) {
  try {
    if (enabled) {
      storage.setItem(NOTIFICATION_SYNC_STORAGE_KEY, "true");
    } else {
      storage.removeItem(NOTIFICATION_SYNC_STORAGE_KEY);
    }
  } catch (cause) {
    throw new NotificationClientError("通知設定を端末に保存できませんでした。", {
      cause,
    });
  }
}

export async function enableNotificationsAndSync(
  data,
  dependencies = {},
) {
  const browser = dependencies.browser ?? globalThis;
  assertBrowserSupport(browser);
  validateFirebaseConfig(
    dependencies.firebaseConfig ?? firebaseConfig,
    dependencies.vapidPublicKey ?? vapidPublicKey,
    dependencies.appCheckRecaptchaSiteKey ?? appCheckRecaptchaSiteKey,
  );

  const permission = await browser.Notification.requestPermission();
  if (permission !== "granted") {
    throw new NotificationClientError(
      permission === "denied"
        ? "通知が許可されていません。ブラウザーのサイト設定から許可してください。"
        : "通知の許可を確認できませんでした。",
    );
  }

  return syncNotificationSnapshot(data, dependencies);
}

export async function syncNotificationSnapshot(data, dependencies = {}) {
  const browser = dependencies.browser ?? globalThis;
  assertBrowserSupport(browser);
  if (browser.Notification.permission !== "granted") {
    throw new NotificationClientError(
      "通知が許可されていません。通知設定画面から許可してください。",
    );
  }

  const publicVapidKey = dependencies.vapidPublicKey ?? vapidPublicKey;
  const authorization = await getFirebaseAuthorization(dependencies);
  const { sdk, app } = authorization;
  const serviceWorkerRegistration = await (
    dependencies.registerServiceWorker ?? registerNotificationServiceWorker
  )();
  const messaging = sdk.getMessaging(app);
  const fcmToken = await sdk.getFcmToken(messaging, {
    vapidKey: publicVapidKey,
    serviceWorkerRegistration,
  });
  if (typeof fcmToken !== "string" || fcmToken.length === 0) {
    throw new NotificationClientError("FCMの通知先端末を取得できませんでした。");
  }

  const payload = createNotificationSyncPayload(
    data.todos,
    data.calendarEvents,
    dependencies.now ?? new Date(),
  );
  const response = await (dependencies.fetcher ?? fetch)("/api/notifications/sync", {
    method: "POST",
    headers: {
      ...authorization.headers,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fcmToken, payload }),
  });

  let result;
  try {
    result = await response.json();
  } catch (cause) {
    throw new NotificationClientError(
      `通知同期APIの応答を読み取れませんでした (HTTP ${response.status})。`,
      { cause },
    );
  }
  if (!response.ok) {
    throw new NotificationClientError(
      typeof result?.error === "string"
        ? result.error
        : `通知予定を同期できませんでした (HTTP ${response.status})。`,
    );
  }
  if (result?.synced !== true || !Number.isSafeInteger(result.scheduledCount)) {
    throw new NotificationClientError("通知同期APIの応答形式が正しくありません。");
  }
  return { scheduledCount: result.scheduledCount };
}

export async function disableNotificationSync(dependencies = {}) {
  const browser = dependencies.browser ?? globalThis;
  if (!browser.isSecureContext) {
    throw new NotificationClientError("通知設定にはHTTPS接続が必要です。");
  }
  const authorization = await getFirebaseAuthorization(dependencies, {
    requireExistingUser: true,
  });
  const response = await (dependencies.fetcher ?? fetch)(
    "/api/notifications/device",
    { method: "DELETE", headers: authorization.headers },
  );
  let result;
  try {
    result = await response.json();
  } catch (cause) {
    throw new NotificationClientError(
      `通知停止APIの応答を読み取れませんでした (HTTP ${response.status})。`,
      { cause },
    );
  }
  if (!response.ok || result?.removed !== true) {
    throw new NotificationClientError(
      typeof result?.error === "string"
        ? result.error
        : `通知同期を停止できませんでした (HTTP ${response.status})。`,
    );
  }
}

async function getFirebaseAuthorization(
  dependencies,
  { requireExistingUser = false } = {},
) {
  const config = dependencies.firebaseConfig ?? firebaseConfig;
  const publicVapidKey = dependencies.vapidPublicKey ?? vapidPublicKey;
  const recaptchaSiteKey =
    dependencies.appCheckRecaptchaSiteKey ?? appCheckRecaptchaSiteKey;
  validateFirebaseConfig(config, publicVapidKey, recaptchaSiteKey);

  const sdk = await (dependencies.loadFirebaseSdk ?? loadFirebaseSdk)();
  if (!(await sdk.isSupported())) {
    throw new NotificationClientError("このブラウザーではFirebase通知を利用できません。");
  }

  const app =
    sdk.getApps().find((candidate) => candidate.name === "daily-tool-notifications") ??
    sdk.initializeApp(config, "daily-tool-notifications");
  const auth = sdk.getAuth(app);
  appCheckInstance ??= sdk.initializeAppCheck(app, {
    provider: new sdk.ReCaptchaV3Provider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  let user = auth.currentUser;
  if (!user && !requireExistingUser) {
    const result = await sdk.signInAnonymously(auth);
    user = result.user;
  }
  if (!user || typeof user.getIdToken !== "function") {
    throw new NotificationClientError(
      requireExistingUser
        ? "この端末の通知認証情報がありません。同期を有効にした端末で停止してください。"
        : "Firebase匿名認証を完了できませんでした。",
    );
  }

  const idToken = await user.getIdToken();
  const appCheckToken = await sdk.getAppCheckToken(appCheckInstance);
  if (typeof appCheckToken?.token !== "string" || appCheckToken.token.length === 0) {
    throw new NotificationClientError("Firebase App Checkの確認を完了できませんでした。");
  }
  return {
    sdk,
    app,
    headers: {
      authorization: `Bearer ${idToken}`,
      "X-Firebase-AppCheck": appCheckToken.token,
    },
  };
}

function assertBrowserSupport(browser) {
  if (
    !browser.isSecureContext ||
    !browser.navigator?.serviceWorker ||
    !browser.Notification ||
    typeof browser.Notification.requestPermission !== "function"
  ) {
    throw new NotificationClientError(
      "通知にはHTTPS対応ブラウザーとService Workerが必要です。",
    );
  }
}

function validateFirebaseConfig(config, publicVapidKey, recaptchaSiteKey) {
  if (
    !config ||
    ["apiKey", "authDomain", "projectId", "messagingSenderId", "appId"].some(
      (key) => typeof config[key] !== "string" || config[key].trim() === "",
    ) ||
    typeof publicVapidKey !== "string" ||
    publicVapidKey.trim() === "" ||
    typeof recaptchaSiteKey !== "string" ||
    recaptchaSiteKey.trim() === ""
  ) {
    throw new NotificationClientError(
      "Firebase Web設定、FCM VAPID公開鍵、App Checkサイトキーがまだアプリに設定されていません。",
    );
  }
}

async function loadFirebaseSdk() {
  const sdkUrl = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
  try {
    const [app, auth, appCheck, messaging] = await Promise.all([
      import(`${sdkUrl}/firebase-app.js`),
      import(`${sdkUrl}/firebase-auth.js`),
      import(`${sdkUrl}/firebase-app-check.js`),
      import(`${sdkUrl}/firebase-messaging.js`),
    ]);
    return {
      ...app,
      ...auth,
      ...messaging,
      initializeAppCheck: appCheck.initializeAppCheck,
      ReCaptchaV3Provider: appCheck.ReCaptchaV3Provider,
      getAppCheckToken: appCheck.getToken,
      getFcmToken: messaging.getToken,
    };
  } catch (cause) {
    throw new NotificationClientError("Firebase SDKを読み込めませんでした。", {
      cause,
    });
  }
}
