import {
  FirebaseAppCheckKeyServiceError,
  InvalidFirebaseAppCheckTokenError,
  verifyFirebaseAppCheckToken,
} from "../../../src/features/notifications/firebaseAppCheckVerifier.js";
import {
  FirebaseKeyServiceError,
  InvalidFirebaseIdTokenError,
  verifyFirebaseIdToken,
} from "../../../src/features/notifications/firebaseTokenVerifier.js";

export async function onRequestDelete({ request, env }) {
  if (
    !env?.DB ||
    typeof env.DB.prepare !== "function" ||
    typeof env.FIREBASE_PROJECT_ID !== "string" ||
    env.FIREBASE_PROJECT_ID.length === 0 ||
    typeof env.FIREBASE_PROJECT_NUMBER !== "string" ||
    !/^\d+$/.test(env.FIREBASE_PROJECT_NUMBER) ||
    typeof env.FIREBASE_APP_ID !== "string" ||
    env.FIREBASE_APP_ID.length === 0
  ) {
    return jsonResponse(503, { error: "通知同期サービスが設定されていません。" });
  }

  const identityToken = getBearerToken(request.headers.get("authorization"));
  if (!identityToken) {
    return jsonResponse(401, { error: "通知同期には認証が必要です。" });
  }

  let identity;
  try {
    identity = await verifyFirebaseIdToken(identityToken, env.FIREBASE_PROJECT_ID);
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

  const appCheckToken = request.headers.get("x-firebase-appcheck");
  if (!appCheckToken) {
    return jsonResponse(401, { error: "App Checkによるアプリ確認が必要です。" });
  }
  try {
    await verifyFirebaseAppCheckToken(
      appCheckToken,
      env.FIREBASE_PROJECT_NUMBER,
      env.FIREBASE_APP_ID,
    );
  } catch (error) {
    if (error instanceof InvalidFirebaseAppCheckTokenError) {
      return jsonResponse(401, { error: "App Checkトークンが無効または期限切れです。" });
    }
    if (error instanceof FirebaseAppCheckKeyServiceError) {
      console.error("Firebase App Check署名鍵を検証できませんでした。", error);
      return jsonResponse(503, { error: "アプリ確認サービスを一時的に利用できません。" });
    }
    throw error;
  }

  await env.DB
    .prepare("DELETE FROM notification_devices WHERE device_id = ?")
    .bind(identity.uid)
    .run();
  return jsonResponse(200, { removed: true });
}

function getBearerToken(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  return match?.[1] ?? null;
}

function jsonResponse(status, body) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
