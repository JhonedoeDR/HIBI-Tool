import assert from "node:assert/strict";
import test from "node:test";
import worker from "../workers/notification-dispatcher.js";

test("daily cron prunes old notification history without requiring FCM credentials", async () => {
  const statements = [];
  const database = {
    prepare(sql) {
      return {
        bind(...values) {
          statements.push({ sql, values });
          return {
            async run() {
              return { meta: { changes: 4 } };
            },
          };
        },
      };
    },
  };
  let execution;

  worker.scheduled(
    { cron: "0 0 * * *" },
    { DB: database },
    { waitUntil(promise) { execution = promise; } },
  );
  const result = await execution;

  assert.deepEqual(result, { pruned: 4 });
  assert.match(statements[0].sql, /DELETE FROM scheduled_notifications/);
});

test("minute cron runs notification dispatch", async () => {
  const database = {
    prepare() {
      return { bind() { return {}; } };
    },
    async batch(statements) {
      assert.equal(statements.length, 2);
      return [{ success: true }, { results: [] }];
    },
  };
  let execution;

  worker.scheduled(
    { cron: "* * * * *" },
    { DB: database, FCM_SERVICE_ACCOUNT: "unused-without-jobs" },
    { waitUntil(promise) { execution = promise; } },
  );
  const result = await execution;

  assert.deepEqual(result, { claimed: 0, sent: 0, retried: 0, failed: 0 });
});
