import assert from "node:assert/strict";
import test from "node:test";
import { persistNotificationSnapshot } from "../src/features/notifications/d1NotificationRepository.js";

function createFakeDatabase() {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        bind(...values) {
          statements.push({ sql, values });
          return { sql, values };
        },
      };
    },
    async batch(batchStatements) {
      return batchStatements;
    },
  };
}

test("notification snapshot persistence replaces pending jobs in one D1 batch", async () => {
  const database = createFakeDatabase();
  const now = new Date("2026-11-16T08:00:00.000Z");
  const results = await persistNotificationSnapshot(database, {
    deviceId: "device-1",
    credentialHash: "hashed-secret",
    fcmToken: "fcm-token",
    now,
    payload: {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      notifications: [
        {
          id: "past",
          scheduledAt: "2026-11-16T07:00:00.000Z",
          title: "Past",
          body: "Skipped",
          sourceType: "todo",
          sourceId: "todo-past",
        },
        {
          id: "future",
          scheduledAt: "2026-11-16T09:00:00.000Z",
          title: "Task",
          body: "開始日",
          sourceType: "todo",
          sourceId: "todo-1",
        },
      ],
    },
  });

  assert.equal(results.length, 3);
  assert.equal(database.statements.length, 3);
  assert.match(database.statements[0].sql, /INSERT INTO notification_devices/);
  assert.match(database.statements[1].sql, /status = 'pending'/);
  assert.equal(database.statements[2].values[1], "future");
  assert.equal(database.statements[2].values[2], new Date("2026-11-16T09:00:00.000Z").getTime());
});

test("invalid notification snapshots are rejected before any database writes", async () => {
  const database = createFakeDatabase();

  await assert.rejects(
    persistNotificationSnapshot(database, {
      deviceId: "device-1",
      credentialHash: "hashed-secret",
      fcmToken: "fcm-token",
      payload: {
        schemaVersion: 1,
        generatedAt: "invalid",
        notifications: [],
      },
    }),
  );
  assert.equal(database.statements.length, 0);
});
