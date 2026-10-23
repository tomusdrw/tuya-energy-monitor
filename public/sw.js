/* Push only: private pages and API responses are never cached by this worker. */
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function destination(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/#alerts', self.location.origin);
    if (
      url.origin === self.location.origin &&
      url.pathname === '/' &&
      !url.search &&
      /^#(?:alerts|settings|accounts|homes|(?:home|device)\/[A-Za-z0-9_-]{1,128})?$/.test(url.hash)
    )
      return url.href;
  } catch {
    /* Invalid destinations open notification history. */
  }
  return `${self.location.origin}/#alerts`;
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    /* A visible fallback satisfies userVisibleOnly. */
  }
  if (!payload || typeof payload !== 'object') payload = {};
  const title =
    typeof payload.title === 'string' ? payload.title.slice(0, 180) : 'Tuya Energy Monitor';
  event.waitUntil(
    self.registration.showNotification(title, {
      body:
        typeof payload.body === 'string'
          ? payload.body.slice(0, 2000)
          : 'Open the application to view your notifications.',
      tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 80) : 'tem-notification',
      icon: '/icons/icon-192.png',
      data: { url: destination(payload.url) },
      renotify: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = destination(event.notification.data?.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          const navigated = await client.navigate(url);
          if (navigated) {
            await navigated.focus();
            return;
          }
        } catch {
          /* A closing window must not swallow the notification click. */
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
