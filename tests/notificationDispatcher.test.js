import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchDueNotifications,
  PushDeliveryError,
} from "../src/features/notifications/notificationDispatcher.js";

function createFakeDatabase(jobs = []) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        bind(...values) {
          const statement = {
            sql,
            values,
            async all() {
              return { results: jobs };
            },
            async run() {
              statements.push(statement);
              return { success: true };
            },
          };
          return statement;
        },
      };
    },
    async batch(batchStatements) {
      statements.push(...batchStatements);
      if (batchStatements.length === 2 && /RETURNING device_id/.test(batchStatements[1].sql)) {
        return [{ success: true }, { results: jobs }];
      }
      return batchStatements.map(() => ({ success: true }));
    },
  };
}

function createJob(overrides = {}) {
  return {
    device_id: "device-1",
    notification_id: "notification-1",
    scheduled_at_ms: 1000,
    title: "Task",
    body: "Start",
    source_type: "todo",
    source_id: "todo-1",
    attempt_count: 1,
    fcm_token: "token-1",
    ...overrides,
  };
}

test("dispatch claims a bounded batch and marks successful delivery as sent", async () => {
  const database = createFakeDatabase([createJob()]);
  const delivered = [];

  const result = await dispatchDueNotifications(
    database,
    async (job) => delivered.push(job.notification_id),
    10_000,
  );

  assert.deepEqual(result, { claimed: 1, sent: 1, retried: 0, failed: 0 });
  assert.deepEqual(delivered, ["notification-1"]);
  assert.match(database.statements[1].sql, /RETURNING device_id/);
  assert.match(database.statements.at(-1).sql, /SET status = 'sent'/);
});

test("transient delivery failure schedules an exponential retry", async () => {
  const database = createFakeDatabase([createJob({ attempt_count: 2 })]);
  const now = 10_000;

  const result = await dispatchDueNotifications(
    database,
    async () => {
      throw new PushDeliveryError("fcm_http_503", { retryable: true });
    },
    now,
  );

  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 1, failed: 0 });
  const retry = database.statements.at(-1);
  assert.match(retry.sql, /SET status = 'pending'/);
  assert.equal(retry.values[0], now + 2 * 60 * 1000);
  assert.equal(retry.values[1], "fcm_http_503");
});

test("invalid FCM token is failed and removed only if it is still current", async () => {
  const database = createFakeDatabase([createJob()]);

  const result = await dispatchDueNotifications(
    database,
    async () => {
      throw new PushDeliveryError("fcm_http_404", { invalidToken: true });
    },
    10_000,
  );

  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 0, failed: 1 });
  const invalidTokenStatements = database.statements.slice(-2);
  assert.match(invalidTokenStatements[0].sql, /ELSE 'pending'/);
  assert.match(invalidTokenStatements[1].sql, /fcm_token = \?/);
  assert.equal(invalidTokenStatements[1].values[1], "token-1");
});

test("permanent delivery errors fail without scheduling another attempt", async () => {
  const database = createFakeDatabase([createJob()]);

  const result = await dispatchDueNotifications(
    database,
    async () => {
      throw new PushDeliveryError("fcm_http_400");
    },
    10_000,
  );

  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 0, failed: 1 });
  assert.match(database.statements.at(-1).sql, /SET status = 'failed'/);
});
