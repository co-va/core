async function syncAppBadge(count) {
  const value = Math.max(0, Math.trunc(Number(count) || 0));
  try {
    if (value > 0 && typeof self.navigator?.setAppBadge === 'function') {
      await self.navigator.setAppBadge(value);
    } else if (value <= 0 && typeof self.navigator?.clearAppBadge === 'function') {
      await self.navigator.clearAppBadge();
    }
  } catch {}
}

async function notifyUnreadClients(count) {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({
      type: 'va-tools:push-unread',
      count: Math.max(0, Math.trunc(Number(count) || 0)),
    }));
  } catch {}
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text?.() || '' };
  }

  const title = String(payload.title || 'VA Tools');
  const options = {
    body: String(payload.body || ''),
    tag: String(payload.tag || payload.notificationId || ''),
    renotify: false,
    data: {
      url: String(payload.url || '/'),
      notificationId: String(payload.notificationId || ''),
    },
  };

  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    syncAppBadge(payload.badgeCount),
    notifyUnreadClients(payload.badgeCount),
  ]));
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'va-tools:badge') return;
  event.waitUntil(syncAppBadge(event.data?.count));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification?.data?.url || '/', self.location.origin).toString();

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        if ('navigate' in client) await client.navigate(targetUrl);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    return null;
  })());
});
