import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import {
  createFcmAccessToken,
  sendFcmNotification,
} from "../src/features/notifications/fcmClient.js";
import { PushDeliveryError } from "../src/features/notifications/notificationDispatcher.js";

test("creates a signed OAuth assertion and sends the FCM message", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://oauth2.googleapis.com/token") {
      return { ok: true, json: async () => ({ access_token: "access-token" }) };
    }
    return { ok: true };
  };
  const now = Date.UTC(2026, 10, 16, 8);

  const credentials = await createFcmAccessToken(
    {
      project_id: "daily-tool",
      client_email: "service@example.iam.gserviceaccount.com",
      private_key: privateKey,
    },
    fetcher,
    now,
  );
  await sendFcmNotification(
    credentials.accessToken,
    credentials.projectId,
    {
      fcm_token: "device-token",
      notification_id: "reminder-1",
      title: "Task",
      body: "Start",
      source_type: "todo",
      source_id: "todo-1",
    },
    fetcher,
  );

  const form = new URLSearchParams(calls[0].options.body);
  const assertion = form.get("assertion");
  const [headerPart, payloadPart, signaturePart] = assertion.split(".");
  const header = JSON.parse(Buffer.from(headerPart, "base64url"));
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url"));
  assert.equal(header.alg, "RS256");
  assert.equal(payload.iss, "service@example.iam.gserviceaccount.com");
  assert.equal(payload.aud, "https://oauth2.googleapis.com/token");
  assert.equal(payload.iat, now / 1000);
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(`${headerPart}.${payloadPart}`),
      publicKey,
      Buffer.from(signaturePart, "base64url"),
    ),
    true,
  );
  assert.equal(calls[1].url, "https://fcm.googleapis.com/v1/projects/daily-tool/messages:send");
  assert.equal(calls[1].options.headers.authorization, "Bearer access-token");
  assert.deepEqual(JSON.parse(calls[1].options.body).message.notification, {
    title: "Task",
    body: "Start",
  });
});

test("classifies an unregistered token so the device can be removed", async () => {
  await assert.rejects(
    sendFcmNotification(
      "access-token",
      "daily-tool",
      { fcm_token: "invalid-token" },
      async () => ({
        ok: false,
        status: 404,
        async json() {
          return {
            error: {
              details: [
                {
                  "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                  errorCode: "UNREGISTERED",
                },
              ],
            },
          };
        },
      }),
    ),
    (error) =>
      error instanceof PushDeliveryError &&
      error.invalidToken &&
      error.code === "fcm_http_404",
  );
});

test("does not classify unrelated FCM 404 responses as stale device tokens", async () => {
  await assert.rejects(
    sendFcmNotification(
      "access-token",
      "daily-tool",
      { fcm_token: "device-token" },
      async () => ({
        ok: false,
        status: 404,
        async json() {
          return { error: { status: "NOT_FOUND", details: [] } };
        },
      }),
    ),
    (error) =>
      error instanceof PushDeliveryError &&
      !error.invalidToken &&
      !error.retryable,
  );
});
