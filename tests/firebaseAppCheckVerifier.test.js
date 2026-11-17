import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  FirebaseAppCheckKeyServiceError,
  InvalidFirebaseAppCheckTokenError,
  verifyFirebaseAppCheckToken,
} from "../src/features/notifications/firebaseAppCheckVerifier.js";

function createSignedToken(overrides = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const publicJwk = createPublicKey(publicKey).export({ format: "jwk" });
  const keyId = `app-check-key-${crypto.randomUUID()}`;
  const now = Date.UTC(2026, 10, 16, 8);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: "https://firebaseappcheck.googleapis.com/123456789",
      aud: ["projects/123456789"],
      sub: "1:123456789:web:app-id",
      exp: Math.floor(now / 1000) + 3600,
      ...overrides,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return {
    token: `${signingInput}.${encodeBase64Url(signature)}`,
    publicJwk: { ...publicJwk, kid: keyId, use: "sig" },
    now,
  };
}

function createFetcher(publicJwk) {
  return async () => ({
    ok: true,
    headers: { get: () => "public, max-age=300" },
    json: async () => ({ keys: [publicJwk] }),
  });
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

test("verifies App Check token signature, project audience, and allowed app ID", async () => {
  const { token, publicJwk, now } = createSignedToken();

  const result = await verifyFirebaseAppCheckToken(
    token,
    "123456789",
    "1:123456789:web:app-id",
    { fetcher: createFetcher(publicJwk), now },
  );

  assert.deepEqual(result, { appId: "1:123456789:web:app-id" });
});

test("rejects expired tokens, wrong app IDs, and invalid signatures", async () => {
  const expired = createSignedToken({
    exp: Math.floor(Date.UTC(2026, 10, 16, 8) / 1000) - 60,
  });
  await assert.rejects(
    verifyFirebaseAppCheckToken(
      expired.token,
      "123456789",
      "1:123456789:web:app-id",
      { fetcher: createFetcher(expired.publicJwk), now: expired.now },
    ),
    InvalidFirebaseAppCheckTokenError,
  );

  const token = createSignedToken();
  await assert.rejects(
    verifyFirebaseAppCheckToken(
      token.token,
      "123456789",
      "different-app-id",
      { fetcher: createFetcher(token.publicJwk), now: token.now },
    ),
    InvalidFirebaseAppCheckTokenError,
  );

  const other = createSignedToken();
  const invalidSignature = `${token.token.split(".").slice(0, 2).join(".")}.${other.token.split(".")[2]}`;
  await assert.rejects(
    verifyFirebaseAppCheckToken(
      invalidSignature,
      "123456789",
      "1:123456789:web:app-id",
      { fetcher: createFetcher(token.publicJwk), now: token.now },
    ),
    InvalidFirebaseAppCheckTokenError,
  );
});

test("reports App Check key-service failures separately from invalid tokens", async () => {
  const { token, now } = createSignedToken();

  await assert.rejects(
    verifyFirebaseAppCheckToken(token, "123456789", "1:123456789:web:app-id", {
      fetcher: async () => {
        throw new Error("offline");
      },
      now,
    }),
    FirebaseAppCheckKeyServiceError,
  );
});
