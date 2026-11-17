import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  FirebaseKeyServiceError,
  InvalidFirebaseIdTokenError,
  verifyFirebaseIdToken,
} from "../src/features/notifications/firebaseTokenVerifier.js";

function createSignedToken(overrides = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const publicJwk = createPublicKey(publicKey).export({ format: "jwk" });
  const keyId = `key-${crypto.randomUUID()}`;
  const now = Date.UTC(2026, 10, 16, 8);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", kid: keyId }));
  const payload = encodeBase64Url(
    JSON.stringify({
      aud: "daily-tool",
      iss: "https://securetoken.google.com/daily-tool",
      sub: "anonymous-user-1",
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
      auth_time: Math.floor(now / 1000),
      firebase: { sign_in_provider: "anonymous" },
      ...overrides,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return {
    token: `${signingInput}.${encodeBase64Url(signature)}`,
    publicJwk: { ...publicJwk, kid: keyId, alg: "RS256", use: "sig" },
    now,
  };
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function createFetcher(publicJwk) {
  return async () => ({
    ok: true,
    headers: { get: () => "public, max-age=300" },
    json: async () => ({ keys: [publicJwk] }),
  });
}

test("verifies Firebase anonymous ID-token signature and claims", async () => {
  const { token, publicJwk, now } = createSignedToken();

  const identity = await verifyFirebaseIdToken(token, "daily-tool", {
    fetcher: createFetcher(publicJwk),
    now,
  });

  assert.deepEqual(identity, { uid: "anonymous-user-1" });
});

test("rejects expired, non-anonymous, and invalidly signed tokens", async () => {
  const expired = createSignedToken({ exp: Math.floor(Date.UTC(2026, 10, 16, 8) / 1000) - 60 });
  await assert.rejects(
    verifyFirebaseIdToken(expired.token, "daily-tool", {
      fetcher: createFetcher(expired.publicJwk),
      now: expired.now,
    }),
    InvalidFirebaseIdTokenError,
  );

  const registeredUser = createSignedToken({
    firebase: { sign_in_provider: "password" },
  });
  await assert.rejects(
    verifyFirebaseIdToken(registeredUser.token, "daily-tool", {
      fetcher: createFetcher(registeredUser.publicJwk),
      now: registeredUser.now,
    }),
    InvalidFirebaseIdTokenError,
  );

  const invalidSignature = createSignedToken();
  const otherKey = createSignedToken();
  const invalidToken = `${invalidSignature.token.split(".").slice(0, 2).join(".")}.${otherKey.token.split(".")[2]}`;
  await assert.rejects(
    verifyFirebaseIdToken(invalidToken, "daily-tool", {
      fetcher: createFetcher(invalidSignature.publicJwk),
      now: invalidSignature.now,
    }),
    InvalidFirebaseIdTokenError,
  );
});

test("reports signing-key service failures separately from invalid credentials", async () => {
  const { token, now } = createSignedToken();

  await assert.rejects(
    verifyFirebaseIdToken(token, "daily-tool", {
      fetcher: async () => {
        throw new Error("offline");
      },
      now,
    }),
    FirebaseKeyServiceError,
  );
});
