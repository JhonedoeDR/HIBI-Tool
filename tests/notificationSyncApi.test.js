import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { onRequestPost } from "../functions/api/notifications/sync.js";
import { onRequestDelete } from "../functions/api/notifications/device.js";

function createSignedToken() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const keyId = `api-key-${crypto.randomUUID()}`;
  const publicJwk = createPublicKey(publicKey).export({ format: "jwk" });
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", kid: keyId }));
  const payload = encodeBase64Url(
    JSON.stringify({
      aud: "daily-tool",
      iss: "https://securetoken.google.com/daily-tool",
      sub: "anonymous-user-1",
      iat: issuedAt,
      exp: issuedAt + 3600,
      auth_time: issuedAt,
      firebase: { sign_in_provider: "anonymous" },
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return {
    token: `${signingInput}.${encodeBase64Url(signature)}`,
    publicJwk: { ...publicJwk, kid: keyId, alg: "RS256", use: "sig" },
  };
}

function createSignedAppCheckToken() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const keyId = `app-check-${crypto.randomUUID()}`;
  const publicJwk = createPublicKey(publicKey).export({ format: "jwk" });
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: "https://firebaseappcheck.googleapis.com/123456789",
      aud: ["projects/123456789"],
      sub: "1:123456789:web:app-id",
      exp: issuedAt + 3600,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return {
    token: `${signingInput}.${encodeBase64Url(signature)}`,
    publicJwk: { ...publicJwk, kid: keyId, use: "sig" },
  };
}

function createDatabase({ quotaAllowed = true } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          const statement = { sql, values };
          return {
            ...statement,
            async run() {
              calls.push(statement);
              return { success: true };
            },
            async all() {
              calls.push(statement);
              return { results: quotaAllowed ? [{ sync_count: 1 }] : [] };
            },
          };
        },
      };
    },
    async batch(statements) {
      calls.push(...statements);
      return statements.map(() => ({ success: true }));
    },
  };
}

function createRequest(token, appCheckToken, payload = createPayload()) {
  return new Request("https://daily-tool.example/api/notifications/sync", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "X-Firebase-AppCheck": appCheckToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: "client-selected-device",
      fcmToken: "fcm-device-token",
      payload,
    }),
  });
}

function createPayload() {
  const now = new Date();
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    notifications: [
      {
        id: "reminder-1",
        scheduledAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        title: "Task",
        body: "Start",
        sourceType: "todo",
        sourceId: "todo-1",
      },
    ],
  };
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

test("authenticated anonymous user can sync a validated notification snapshot", async (t) => {
  const originalFetch = globalThis.fetch;
  const { token, publicJwk } = createSignedToken();
  const appCheck = createSignedAppCheckToken();
  globalThis.fetch = async (url) => ({
    ok: true,
    headers: { get: () => "public, max-age=300" },
    json: async () => ({
      keys: [url.includes("firebaseappcheck.googleapis.com") ? appCheck.publicJwk : publicJwk],
    }),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const database = createDatabase();
  const response = await onRequestPost({
    request: createRequest(token, appCheck.token),
    env: {
      DB: database,
      FIREBASE_PROJECT_ID: "daily-tool",
      FIREBASE_PROJECT_NUMBER: "123456789",
      FIREBASE_APP_ID: "1:123456789:web:app-id",
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { synced: true, scheduledCount: 1 });
  assert.equal(database.calls[0].values[0], "anonymous-user-1");
  assert.equal(database.calls.filter((call) => /INSERT INTO scheduled_notifications/.test(call.sql)).length, 1);
});

test("unauthenticated requests cannot write to D1", async () => {
  const database = createDatabase();
  const response = await onRequestPost({
    request: new Request("https://daily-tool.example/api/notifications/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fcmToken: "token", payload: createPayload() }),
    }),
    env: {
      DB: database,
      FIREBASE_PROJECT_ID: "daily-tool",
      FIREBASE_PROJECT_NUMBER: "123456789",
      FIREBASE_APP_ID: "1:123456789:web:app-id",
    },
  });

  assert.equal(response.status, 401);
  assert.equal(database.calls.length, 0);
});

test("valid Firebase identity without App Check cannot write to D1", async (t) => {
  const originalFetch = globalThis.fetch;
  const { token, publicJwk } = createSignedToken();
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "public, max-age=300" },
    json: async () => ({ keys: [publicJwk] }),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const database = createDatabase();
  const request = new Request("https://daily-tool.example/api/notifications/sync", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fcmToken: "fcm-device-token", payload: createPayload() }),
  });
  const response = await onRequestPost({
    request,
    env: {
      DB: database,
      FIREBASE_PROJECT_ID: "daily-tool",
      FIREBASE_PROJECT_NUMBER: "123456789",
      FIREBASE_APP_ID: "1:123456789:web:app-id",
    },
  });

  assert.equal(response.status, 401);
  assert.equal(database.calls.length, 0);
});

test("sync quota is enforced before the snapshot is written", async (t) => {
  const originalFetch = globalThis.fetch;
  const { token, publicJwk } = createSignedToken();
  const appCheck = createSignedAppCheckToken();
  globalThis.fetch = async (url) => ({
    ok: true,
    headers: { get: () => "public, max-age=300" },
    json: async () => ({
      keys: [url.includes("firebaseappcheck.googleapis.com") ? appCheck.publicJwk : publicJwk],
    }),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const database = createDatabase({ quotaAllowed: false });
  const response = await onRequestPost({
    request: createRequest(token, appCheck.token),
    env: {
      DB: database,
      FIREBASE_PROJECT_ID: "daily-tool",
      FIREBASE_PROJECT_NUMBER: "123456789",
      FIREBASE_APP_ID: "1:123456789:web:app-id",
    },
  });

  assert.equal(response.status, 429);
  assert.equal(database.calls.filter((call) => /INSERT INTO scheduled_notifications/.test(call.sql)).length, 0);
});

test("notification stop only deletes the authenticated UID's device and its jobs", async (t) => {
  const originalFetch = globalThis.fetch;
  const { token, publicJwk } = createSignedToken();
  const appCheck = createSignedAppCheckToken();
  globalThis.fetch = async (url) => ({
    ok: true,
    headers: { get: () => "public, max-age=300" },
    json: async () => ({
      keys: [url.includes("firebaseappcheck.googleapis.com") ? appCheck.publicJwk : publicJwk],
    }),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const database = createDatabase();
  const response = await onRequestDelete({
    request: new Request("https://daily-tool.example/api/notifications/device", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
        "X-Firebase-AppCheck": appCheck.token,
      },
    }),
    env: {
      DB: database,
      FIREBASE_PROJECT_ID: "daily-tool",
      FIREBASE_PROJECT_NUMBER: "123456789",
      FIREBASE_APP_ID: "1:123456789:web:app-id",
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { removed: true });
  const deletion = database.calls.find((call) =>
    /DELETE FROM notification_devices/.test(call.sql),
  );
  assert.deepEqual(deletion.values, ["anonymous-user-1"]);
});

test("notification stop rejects missing App Check before touching D1", async (t) => {
  const originalFetch = globalThis.fetch;
  const { token, publicJwk } = createSignedToken();
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "public, max-age=300" },
    json: async () => ({ keys: [publicJwk] }),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const database = createDatabase();
  const response = await onRequestDelete({
    request: new Request("https://daily-tool.example/api/notifications/device", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    }),
    env: {
      DB: database,
      FIREBASE_PROJECT_ID: "daily-tool",
      FIREBASE_PROJECT_NUMBER: "123456789",
      FIREBASE_APP_ID: "1:123456789:web:app-id",
    },
  });

  assert.equal(response.status, 401);
  assert.equal(database.calls.length, 0);
});
