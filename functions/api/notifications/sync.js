import { verifyFirebaseIdToken, FirebaseKeyServiceError, InvalidFirebaseIdTokenError } from "../../../src/features/notifications/firebaseTokenVerifier.js";
import {
  consumeNotificationSyncQuota,
  persistNotificationSnapshot,
} from "../../../src/features/notifications/d1NotificationRepository.js";
import {
  NotificationSyncValidationError,
  validateNotificationSyncPayload,
} from "../../../src/features/notifications/notificationSyncService.js";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_NOTIFICATIONS_PER_SYNC = 500;

export async function onRequestPost({ request, env }) {
  if (
    !env?.DB ||
    typeof env.DB.prepare !== "function" ||
    typeof env.DB.batch !== "function" ||
    typeof env.FIREBASE_PROJECT_ID !== "string" ||
    env.FIREBASE_PROJECT_ID.length === 0
  ) {
    return jsonResponse(503, { error: "通知同期サービスが設定されていません。" });
  }

  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) {
    return jsonResponse(401, { error: "通知同期には認証が必要です。" });
  }

  let identity;
  try {
    identity = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
  } catch (error) {
    if (error instanceof InvalidFirebaseIdTokenError) {
      return jsonResponse(401, { error: "認証情報が無効または期限切れです。" });
    }
    if (error instanceof FirebaseKeyServiceError) {
      console.error("Firebaseの署名鍵を検証できませんでした。", error);
      return jsonResponse(503, { error: "認証サービスを一時的に利用できません。" });
    }
    throw error;
  }

  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    return jsonResponse(415, { error: "JSON形式のリクエストが必要です。" });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "通知同期データが大きすぎます。" });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "通知同期データが大きすぎます。" });
  }

  let input;
  try {
    input = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonResponse(400, { error: "JSON形式が正しくありません。" });
    }
    throw error;
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.fcmToken !== "string" ||
    input.fcmToken.length === 0 ||
    input.fcmToken.length > 4096 ||
    !input.payload ||
    typeof input.payload !== "object" ||
    !Array.isArray(input.payload.notifications)
  ) {
    return jsonResponse(400, { error: "通知同期データの形式が正しくありません。" });
  }
  if (input.payload.notifications.length > MAX_NOTIFICATIONS_PER_SYNC) {
    return jsonResponse(413, { error: "一度に同期できる通知数を超えています。" });
  }

  let payload;
  try {
    payload = validateNotificationSyncPayload(input.payload);
  } catch (error) {
    if (error instanceof NotificationSyncValidationError) {
      return jsonResponse(400, { error: error.message });
    }
    throw error;
  }

  const now = new Date();
  const withinQuota = await consumeNotificationSyncQuota(env.DB, {
    deviceId: identity.uid,
    fcmToken: input.fcmToken,
    now,
  });
  if (!withinQuota) {
    const windowEnd = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000;
    const retryAfter = Math.max(1, Math.ceil((windowEnd - now.getTime()) / 1000));
    return jsonResponse(
      429,
      { error: "通知同期の回数制限に達しました。" },
      { "retry-after": String(retryAfter) },
    );
  }

  await persistNotificationSnapshot(env.DB, {
    deviceId: identity.uid,
    fcmToken: input.fcmToken,
    payload,
    now,
  });
  const scheduledCount = payload.notifications.filter(
    (notification) => Date.parse(notification.scheduledAt) > now.getTime(),
  ).length;
  return jsonResponse(200, { synced: true, scheduledCount });
}

function getBearerToken(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  return match?.[1] ?? null;
}

function jsonResponse(status, body, additionalHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...additionalHeaders,
    },
  });
}
