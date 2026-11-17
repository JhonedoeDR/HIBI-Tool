const GOOGLE_PUBLIC_KEYS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const KEY_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 30;

let cachedKeys;
let cachedKeysExpireAt = 0;

export class InvalidFirebaseIdTokenError extends Error {
  constructor(message = "Firebase ID token is invalid.") {
    super(message);
    this.name = "InvalidFirebaseIdTokenError";
  }
}

export class FirebaseKeyServiceError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "FirebaseKeyServiceError";
  }
}

export async function verifyFirebaseIdToken(
  token,
  projectId,
  { fetcher = fetch, now = Date.now() } = {},
) {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 8192 ||
    typeof projectId !== "string" ||
    projectId.length === 0 ||
    typeof fetcher !== "function" ||
    !Number.isSafeInteger(now)
  ) {
    throw new InvalidFirebaseIdTokenError();
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new InvalidFirebaseIdTokenError();
  }

  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  const nowSeconds = Math.floor(now / 1000);
  if (
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    !header.kid ||
    claims.aud !== projectId ||
    claims.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    claims.sub.length > 128 ||
    !Number.isSafeInteger(claims.exp) ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.auth_time) ||
    claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS ||
    claims.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
    claims.auth_time > nowSeconds + CLOCK_SKEW_SECONDS ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > 3600 + CLOCK_SKEW_SECONDS ||
    claims.firebase?.sign_in_provider !== "anonymous"
  ) {
    throw new InvalidFirebaseIdTokenError();
  }

  const signature = decodeBase64Url(parts[2]);
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const key = await findSigningKey(header.kid, fetcher, now);
  let validSignature;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    validSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signature,
      signingInput,
    );
  } catch (cause) {
    throw new FirebaseKeyServiceError("Firebase署名鍵を使用できません。", { cause });
  }
  if (!validSignature) {
    throw new InvalidFirebaseIdTokenError();
  }

  return { uid: claims.sub };
}

async function findSigningKey(keyId, fetcher, now) {
  let keys = await loadSigningKeys(fetcher, now);
  let key = keys.find((candidate) => candidate.kid === keyId);
  if (!key) {
    keys = await loadSigningKeys(fetcher, now, true);
    key = keys.find((candidate) => candidate.kid === keyId);
  }
  if (!key || key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig") {
    throw new InvalidFirebaseIdTokenError();
  }
  return key;
}

async function loadSigningKeys(fetcher, now, forceRefresh = false) {
  if (!forceRefresh && cachedKeys && now < cachedKeysExpireAt) {
    return cachedKeys;
  }

  let response;
  try {
    response = await fetcher(GOOGLE_PUBLIC_KEYS_URL);
  } catch (cause) {
    throw new FirebaseKeyServiceError("Firebase署名鍵を取得できません。", { cause });
  }
  if (!response.ok) {
    throw new FirebaseKeyServiceError(
      `Firebase署名鍵を取得できません (HTTP ${response.status})。`,
    );
  }

  let keySet;
  try {
    keySet = await response.json();
  } catch (cause) {
    throw new FirebaseKeyServiceError("Firebase署名鍵の応答を解析できません。", {
      cause,
    });
  }
  if (!keySet || !Array.isArray(keySet.keys) || keySet.keys.length === 0) {
    throw new FirebaseKeyServiceError("Firebase署名鍵の応答形式が正しくありません。");
  }

  const maxAge = response.headers?.get("cache-control")?.match(/max-age=(\d+)/i)?.[1];
  const cacheDuration = maxAge
    ? Math.min(Number(maxAge) * 1000, KEY_CACHE_MAX_AGE_MS)
    : 5 * 60 * 1000;
  cachedKeys = keySet.keys;
  cachedKeysExpireAt = now + cacheDuration;
  return cachedKeys;
}

function decodeJwtPart(part) {
  try {
    const decoded = new TextDecoder().decode(decodeBase64Url(part));
    const value = JSON.parse(decoded);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("JWT part is not an object.");
    }
    return value;
  } catch {
    throw new InvalidFirebaseIdTokenError();
  }
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidFirebaseIdTokenError();
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
