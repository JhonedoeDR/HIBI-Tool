import { PushDeliveryError } from "./notificationDispatcher.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export async function createFcmAccessToken(serviceAccount, fetcher = fetch, now = Date.now()) {
  const credentials =
    typeof serviceAccount === "string" ? JSON.parse(serviceAccount) : serviceAccount;
  if (
    !credentials ||
    typeof credentials.project_id !== "string" ||
    credentials.project_id.length === 0 ||
    typeof credentials.client_email !== "string" ||
    typeof credentials.private_key !== "string" ||
    typeof fetcher !== "function" ||
    !Number.isSafeInteger(now)
  ) {
    throw new TypeError("FCMサービスアカウント設定が正しくありません。");
  }

  const issuedAt = Math.floor(now / 1000);
  const assertion = await createSignedAssertion(credentials, issuedAt);
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`FCMアクセストークンを取得できませんでした (HTTP ${response.status})。`);
  }

  const tokenResponse = await response.json();
  if (
    typeof tokenResponse.access_token !== "string" ||
    tokenResponse.access_token.length === 0
  ) {
    throw new Error("FCMアクセストークン応答の形式が正しくありません。");
  }
  return { accessToken: tokenResponse.access_token, projectId: credentials.project_id };
}

export async function sendFcmNotification(
  accessToken,
  projectId,
  job,
  fetcher = fetch,
) {
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    typeof projectId !== "string" ||
    projectId.length === 0 ||
    typeof job?.fcm_token !== "string" ||
    typeof fetcher !== "function"
  ) {
    throw new TypeError("FCM通知送信の設定が正しくありません。");
  }

  let response;
  try {
    response = await fetcher(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: job.fcm_token,
            notification: { title: job.title, body: job.body },
            data: {
              notificationId: job.notification_id,
              sourceType: job.source_type,
              sourceId: job.source_id,
            },
          },
        }),
      },
    );
  } catch {
    throw new PushDeliveryError("fcm_network_error", { retryable: true });
  }

  if (!response.ok) {
    const invalidToken = response.status === 404;
    const retryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status === 401 ||
      response.status >= 500;
    throw new PushDeliveryError(`fcm_http_${response.status}`, {
      retryable,
      invalidToken,
    });
  }
}

async function createSignedAssertion(credentials, issuedAt) {
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const unsignedAssertion = `${header}.${payload}`;
  const privateKey = await importPrivateKey(credentials.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedAssertion),
  );
  return `${unsignedAssertion}.${encodeBase64Url(signature)}`;
}

async function importPrivateKey(pem) {
  const match = pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
  if (!match) {
    throw new TypeError("FCM秘密鍵の形式が正しくありません。");
  }
  const binary = atob(match[1].replace(/\s/g, ""));
  const keyBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function encodeBase64Url(value) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
