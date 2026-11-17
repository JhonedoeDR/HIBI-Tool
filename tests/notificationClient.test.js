import assert from "node:assert/strict";
import test from "node:test";
import {
  enableNotificationsAndSync,
  loadNotificationSyncPreference,
  NOTIFICATION_SYNC_STORAGE_KEY,
  NotificationClientError,
  saveNotificationSyncPreference,
  syncNotificationSnapshot,
} from "../src/features/notifications/notificationClient.js";

const firebaseConfig = {
  apiKey: "web-api-key",
  authDomain: "daily-tool.firebaseapp.com",
  projectId: "daily-tool",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc",
};

function createDependencies(overrides = {}) {
  const calls = [];
  const user = {
    async getIdToken() {
      return "firebase-id-token";
    },
  };
  const sdk = {
    isSupported: async () => true,
    getApps: () => [],
    initializeApp(config, name) {
      calls.push({ type: "initialize", config, name });
      return { name };
    },
    getAuth: () => ({ currentUser: null }),
    async signInAnonymously() {
      calls.push({ type: "anonymous-sign-in" });
      return { user };
    },
    getMessaging: () => ({ app: "daily-tool" }),
    async getToken(_messaging, options) {
      calls.push({ type: "get-token", options });
      return "fcm-device-token";
    },
  };
  const browser = {
    isSecureContext: true,
    navigator: { serviceWorker: {} },
    Notification: {
      permission: "default",
      async requestPermission() {
        calls.push({ type: "request-permission" });
        this.permission = "granted";
        return "granted";
      },
    },
  };
  const data = {
    todos: [
      {
        id: "todo-1",
        title: "Test task",
        completed: false,
        startDate: "2026-11-18",
        dueDate: null,
      },
    ],
    calendarEvents: [],
  };
  const dependencies = {
    browser,
    firebaseConfig,
    vapidPublicKey: "public-vapid-key",
    loadFirebaseSdk: async () => sdk,
    registerServiceWorker: async () => ({ scope: "https://daily-tool.example/" }),
    fetcher: async (url, options) => {
      calls.push({ type: "sync", url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { synced: true, scheduledCount: 1 };
        },
      };
    },
    now: new Date("2026-11-17T00:00:00.000Z"),
    ...overrides,
  };
  return { calls, data, dependencies };
}

test("enables push on user action and syncs an authenticated full snapshot", async () => {
  const { calls, data, dependencies } = createDependencies();

  const result = await enableNotificationsAndSync(data, dependencies);

  assert.deepEqual(result, { scheduledCount: 1 });
  assert.equal(calls[0].type, "request-permission");
  assert.equal(calls[1].type, "initialize");
  const request = calls.find((call) => call.type === "sync");
  assert.equal(request.url, "/api/notifications/sync");
  assert.equal(request.options.headers.authorization, "Bearer firebase-id-token");
  const body = JSON.parse(request.options.body);
  assert.equal(body.fcmToken, "fcm-device-token");
  assert.equal(body.payload.notifications[0].sourceId, "todo-1");
  assert.equal(calls.find((call) => call.type === "get-token").options.vapidKey, "public-vapid-key");
});

test("denied browser permission stops before Firebase registration or API writes", async () => {
  let firebaseLoaded = false;
  const { data, dependencies } = createDependencies({
    browser: {
      isSecureContext: true,
      navigator: { serviceWorker: {} },
      Notification: {
        permission: "default",
        async requestPermission() {
          this.permission = "denied";
          return "denied";
        },
      },
    },
    async loadFirebaseSdk() {
      firebaseLoaded = true;
      return {};
    },
  });

  await assert.rejects(
    enableNotificationsAndSync(data, dependencies),
    (error) =>
      error instanceof NotificationClientError &&
      error.message.includes("許可されていません"),
  );
  assert.equal(firebaseLoaded, false);
});

test("missing Firebase configuration is reported before asking for notification permission", async () => {
  let permissionRequested = false;
  const { data, dependencies } = createDependencies({
    firebaseConfig: {},
    browser: {
      isSecureContext: true,
      navigator: { serviceWorker: {} },
      Notification: {
        permission: "default",
        async requestPermission() {
          permissionRequested = true;
          return "granted";
        },
      },
    },
  });

  await assert.rejects(
    enableNotificationsAndSync(data, dependencies),
    (error) =>
      error instanceof NotificationClientError &&
      error.message.includes("Firebase Web設定"),
  );
  assert.equal(permissionRequested, false);
});

test("automatic sync does not prompt again and surfaces API authentication errors", async () => {
  const { data, dependencies } = createDependencies({
    browser: {
      isSecureContext: true,
      navigator: { serviceWorker: {} },
      Notification: {
        permission: "granted",
        async requestPermission() {
          throw new Error("Permission prompt must not run");
        },
      },
    },
    fetcher: async () => ({
      ok: false,
      status: 401,
      async json() {
        return { error: "認証情報が無効または期限切れです。" };
      },
    }),
  });

  await assert.rejects(
    syncNotificationSnapshot(data, dependencies),
    (error) =>
      error instanceof NotificationClientError &&
      error.message.includes("認証情報が無効"),
  );
});

test("stores the notification sync preference and reports storage failures", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  assert.equal(loadNotificationSyncPreference(storage), false);
  saveNotificationSyncPreference(true, storage);
  assert.equal(values.get(NOTIFICATION_SYNC_STORAGE_KEY), "true");
  assert.equal(loadNotificationSyncPreference(storage), true);
  saveNotificationSyncPreference(false, storage);
  assert.equal(loadNotificationSyncPreference(storage), false);
  assert.throws(
    () => saveNotificationSyncPreference(true, { setItem() { throw new Error("full"); } }),
    NotificationClientError,
  );
});
