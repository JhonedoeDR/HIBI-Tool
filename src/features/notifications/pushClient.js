export async function registerNotificationServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("このブラウザーはService Workerに対応していません。");
  }

  const scriptUrl = new URL("../../../service-worker.js", import.meta.url);
  const scopeUrl = new URL("../../../", import.meta.url);
  return navigator.serviceWorker.register(scriptUrl, { scope: scopeUrl.pathname });
}
