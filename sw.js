/* Orbit service worker — cache shell + reminders + push */
const CACHE = 'orbit-v4';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/db.js',
  './js/gamification.js',
  './js/reminders.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg'
];

/** @type {{ id: string, name: string, reminderTime: string, date: string }[]} */
let reminderPlan = [];
let remindersEnabled = false;
const fired = new Set();

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim()).then(() => checkReminders())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: true }).then((cached) =>
        cached || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())
      )
    )
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'orbit-reminders') {
    reminderPlan = Array.isArray(data.plan) ? data.plan : [];
    remindersEnabled = !!data.enabled;
    checkReminders();
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'orbit-reminders') {
    event.waitUntil(checkReminders());
  }
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Orbit', body: 'Time for your habits.', tag: 'orbit-push' };
  try {
    if (event.data) {
      const json = event.data.json();
      payload = { ...payload, ...json };
    }
  } catch (_) {
    try {
      payload.body = event.data ? event.data.text() : payload.body;
    } catch (_) { /* ignore */ }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Orbit', {
      body: payload.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: payload.tag || 'orbit-push',
      renotify: true,
      data: { url: payload.url || './' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.postMessage({ type: 'orbit-notificationclick' });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    }).then(() => checkReminders())
  );
});

function parseHHMM(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

async function checkReminders() {
  if (!remindersEnabled || !reminderPlan.length) return;
  const today = todayStr();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  for (const item of reminderPlan) {
    if (item.date && item.date !== today) continue;
    const parsed = parseHHMM(item.reminderTime);
    if (!parsed) continue;
    if (nowMin !== parsed.h * 60 + parsed.min) continue;
    const key = item.id + '|' + item.reminderTime + '|' + today;
    if (fired.has(key)) continue;
    fired.add(key);
    await self.registration.showNotification('Orbit · ' + (item.name || 'Habit'), {
      body: 'Time for your habit.',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'orbit-' + item.id,
      renotify: true,
      data: { url: './' }
    });
  }

  for (const k of Array.from(fired)) {
    if (!k.endsWith('|' + today)) fired.delete(k);
  }
}

// Lightweight interval while SW is alive (best-effort)
setInterval(() => { checkReminders(); }, 30000);
