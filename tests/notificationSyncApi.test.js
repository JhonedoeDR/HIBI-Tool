import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { onRequestPost } from "../functions/api/notifications/sync.js";

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

function createRequest(token, payload = createPayload()) {
  return new Request("https://daily-tool.example/api/notifications/sync", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
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
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "public, max-age=300" },
    json: async () => ({ keys: [publicJwk] }),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const database = createDatabase();
  const response = await onRequestPost({
    request: createRequest(token),
    env: { DB: database, FIREBASE_PROJECT_ID: "daily-tool" },
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
    env: { DB: database, FIREBASE_PROJECT_ID: "daily-tool" },
  });

  assert.equal(response.status, 401);
  assert.equal(database.calls.length, 0);
});

test("sync quota is enforced before the snapshot is written", async (t) => {
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

  const database = createDatabase({ quotaAllowed: false });
  const response = await onRequestPost({
    request: createRequest(token),
    env: { DB: database, FIREBASE_PROJECT_ID: "daily-tool" },
  });

  assert.equal(response.status, 429);
  assert.equal(database.calls.filter((call) => /INSERT INTO scheduled_notifications/.test(call.sql)).length, 0);
});
