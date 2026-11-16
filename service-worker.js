self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  const rawPayload = event.data.text();
  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    payload = { body: rawPayload };
  }

  const notification =
    payload?.notification && typeof payload.notification === "object"
      ? payload.notification
      : payload;
  const title =
    typeof notification?.title === "string" && notification.title.trim()
      ? notification.title.trim()
      : "Daily-tool";
  const body = typeof notification?.body === "string" ? notification.body : "";
  const tag =
    typeof payload?.data?.notificationId === "string"
      ? payload.data.notificationId
      : undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "./public/assets/app-icon.svg",
      tag,
      data: { url: self.registration.scope },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const appWindow = windows[0];
      if (appWindow) {
        await appWindow.focus();
        return;
      }
      await self.clients.openWindow(self.registration.scope);
    })(),
  );
});
