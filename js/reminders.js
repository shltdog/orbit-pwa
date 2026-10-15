/**
 * Orbit local reminders + optional Web Push subscribe
 */
(function (global) {
  'use strict';

  let checkTimer = null;
  const firedToday = new Set(); // habitId|HH:MM|date

  function appUrl() {
    try {
      return new URL('./', location.href).href;
    } catch (_) {
      return location.origin + location.pathname.replace(/index\.html$/, '');
    }
  }

  function parseHHMM(t) {
    if (!t || typeof t !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return { h, min };
  }

  function msUntilToday(h, min) {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min, 0, 0);
    return target.getTime() - now.getTime();
  }

  async function notificationPermission() {
    if (!('Notification' in global)) return 'unsupported';
    return Notification.permission;
  }

  async function requestPermission() {
    if (!('Notification' in global)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    try {
      return await Notification.requestPermission();
    } catch (_) {
      return Notification.permission;
    }
  }

  async function showLocal(title, body, tag) {
    const perm = await notificationPermission();
    if (perm !== 'granted') return false;
    const opts = {
      body: body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: tag || 'orbit-reminder',
      renotify: true,
      data: { url: appUrl() }
    };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, opts);
      } else {
        new Notification(title, opts);
      }
      return true;
    } catch (err) {
      console.warn('Notification failed', err);
      return false;
    }
  }

  async function pendingRemindersForToday() {
    const today = OrbitDB.today();
    const habits = await OrbitDB.getHabitsDueOn(today);
    const completions = await OrbitDB.getCompletionsForDate(today);
    const done = new Set(completions.map((c) => c.habitId));
    return habits.filter((h) => h.reminderTime && !done.has(h.id));
  }

  async function checkAndFire() {
    const settings = await OrbitDB.getSettings();
    if (!settings.notificationsEnabled) return;
    const perm = await notificationPermission();
    if (perm !== 'granted') return;

    const today = OrbitDB.today();
    const pending = await pendingRemindersForToday();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    for (const h of pending) {
      const parsed = parseHHMM(h.reminderTime);
      if (!parsed) continue;
      const targetMin = parsed.h * 60 + parsed.min;
      // Fire if within the current minute window (and not already fired)
      if (nowMin === targetMin) {
        const key = h.id + '|' + h.reminderTime + '|' + today;
        if (firedToday.has(key)) continue;
        firedToday.add(key);
        await showLocal('Orbit · ' + h.name, 'Time for your habit.', 'orbit-' + h.id);
      }
    }

    // Clear fired keys from other days
    for (const k of Array.from(firedToday)) {
      if (!k.endsWith('|' + today)) firedToday.delete(k);
    }
  }

  function startLocalScheduler() {
    stopLocalScheduler();
    checkAndFire();
    checkTimer = setInterval(checkAndFire, 20000);
  }

  function stopLocalScheduler() {
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
  }

  /** Tell SW to refresh reminder plan (periodicsync / activate hooks). */
  async function syncRemindersToSW() {
    try {
      const settings = await OrbitDB.getSettings();
      const pending = settings.notificationsEnabled ? await pendingRemindersForToday() : [];
      const plan = pending.map((h) => ({
        id: h.id,
        name: h.name,
        reminderTime: h.reminderTime,
        date: OrbitDB.today()
      }));
      const reg = await navigator.serviceWorker.ready;
      if (reg.active) {
        reg.active.postMessage({ type: 'orbit-reminders', plan, enabled: !!settings.notificationsEnabled });
      }
      if ('periodicSync' in reg) {
        try {
          await reg.periodicSync.register('orbit-reminders', { minInterval: 15 * 60 * 1000 });
        } catch (_) { /* not granted / unsupported */ }
      }
    } catch (err) {
      console.warn('SW reminder sync failed', err);
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function pushConfigured() {
    const c = global.OrbitConfig || {};
    return !!(c.PUSH_WORKER_URL && c.VAPID_PUBLIC_KEY);
  }

  async function subscribePush() {
    if (!pushConfigured()) throw new Error('Push not configured');
    if (!('serviceWorker' in navigator) || !('PushManager' in global)) {
      throw new Error('Push not supported on this device');
    }
    const perm = await requestPermission();
    if (perm !== 'granted') throw new Error('Notification permission required');

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(OrbitConfig.VAPID_PUBLIC_KEY)
      });
    }
    const res = await fetch(OrbitConfig.PUSH_WORKER_URL.replace(/\/$/, '') + '/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON())
    });
    if (!res.ok) throw new Error('Subscribe failed (' + res.status + ')');
    await OrbitDB.updateSettings({ pushEnabled: true, notificationsEnabled: true });
    return sub;
  }

  async function unsubscribePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      if (pushConfigured()) {
        try {
          await fetch(OrbitConfig.PUSH_WORKER_URL.replace(/\/$/, '') + '/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub.toJSON())
          });
        } catch (_) { /* offline ok */ }
      }
      await sub.unsubscribe();
    }
    await OrbitDB.updateSettings({ pushEnabled: false });
  }

  async function enableLocalNotifications() {
    const perm = await requestPermission();
    if (perm !== 'granted') return perm;
    await OrbitDB.updateSettings({ notificationsEnabled: true });
    startLocalScheduler();
    await syncRemindersToSW();
    return perm;
  }

  async function disableLocalNotifications() {
    await OrbitDB.updateSettings({ notificationsEnabled: false });
    stopLocalScheduler();
    await syncRemindersToSW();
  }

  async function bootReminders() {
    const settings = await OrbitDB.getSettings();
    if (settings.notificationsEnabled && (await notificationPermission()) === 'granted') {
      startLocalScheduler();
      await syncRemindersToSW();
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        checkAndFire();
        syncRemindersToSW();
      }
    });
    window.addEventListener('focus', () => {
      checkAndFire();
      syncRemindersToSW();
    });
  }

  global.OrbitReminders = {
    parseHHMM,
    appUrl,
    notificationPermission,
    requestPermission,
    showLocal,
    pendingRemindersForToday,
    checkAndFire,
    startLocalScheduler,
    stopLocalScheduler,
    syncRemindersToSW,
    pushConfigured,
    subscribePush,
    unsubscribePush,
    enableLocalNotifications,
    disableLocalNotifications,
    bootReminders,
    msUntilToday
  };
})(typeof window !== 'undefined' ? window : globalThis);
