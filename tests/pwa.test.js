import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("PWA manifest is installable and references a published icon", async () => {
  const manifestUrl = new URL("manifest.webmanifest", projectRoot);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.icons.length, 1);
  await access(new URL(manifest.icons[0].src, projectRoot));
});

test("static build publishes the manifest and push service worker", async () => {
  const buildScript = await readFile(new URL("scripts/build.js", projectRoot), "utf8");
  assert.match(buildScript, /"manifest\.webmanifest"/);
  assert.match(buildScript, /"service-worker\.js"/);
  await access(new URL("service-worker.js", projectRoot));
});

test("push service worker displays notification payloads and opens the app on click", async () => {
  const handlers = new Map();
  const shownNotifications = [];
  const openedUrls = [];
  const self = {
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    registration: {
      scope: "https://daily-tool.example/",
      async showNotification(title, options) {
        shownNotifications.push({ title, options });
      },
    },
    clients: {
      async matchAll() {
        return [];
      },
      async openWindow(url) {
        openedUrls.push(url);
      },
    },
  };
  const source = await readFile(new URL("service-worker.js", projectRoot), "utf8");
  vm.runInNewContext(source, { self });

  let pushWork;
  handlers.get("push")({
    data: {
      text: () =>
        JSON.stringify({
          notification: { title: "締切", body: "提出まで30分です。" },
          data: { notificationId: "deadline-1" },
        }),
    },
    waitUntil(promise) {
      pushWork = promise;
    },
  });
  await pushWork;

  assert.equal(shownNotifications[0].title, "締切");
  assert.equal(shownNotifications[0].options.body, "提出まで30分です。");
  assert.equal(shownNotifications[0].options.tag, "deadline-1");

  let clickWork;
  handlers.get("notificationclick")({
    notification: { close() {} },
    waitUntil(promise) {
      clickWork = promise;
    },
  });
  await clickWork;
  assert.deepEqual(openedUrls, [self.registration.scope]);
});
