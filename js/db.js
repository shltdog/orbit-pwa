/**
 * Orbit IndexedDB wrapper
 * Stores: habits, tasks, completions, meta
 * v2: habit schedules, reminderTime, settings/PIN in meta
 */
(function (global) {
  'use strict';

  const DB_NAME = 'orbit-db';
  const DB_VERSION = 2;

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const from = e.oldVersion;

        if (!db.objectStoreNames.contains('habits')) {
          const habits = db.createObjectStore('habits', { keyPath: 'id' });
          habits.createIndex('sortOrder', 'sortOrder', { unique: false });
        }
        if (!db.objectStoreNames.contains('tasks')) {
          const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
          tasks.createIndex('dueDate', 'dueDate', { unique: false });
          tasks.createIndex('completed', 'completed', { unique: false });
        }
        if (!db.objectStoreNames.contains('completions')) {
          db.createObjectStore('completions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }

        // Migrate habit records when upgrading from v1
        if (from < 2 && db.objectStoreNames.contains('habits')) {
          const tx = e.target.transaction;
          const store = tx.objectStore('habits');
          const cursorReq = store.openCursor();
          cursorReq.onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) return;
            const h = cursor.value;
            let changed = false;
            if (!h.schedule) { h.schedule = 'daily'; changed = true; }
            if (!Array.isArray(h.daysOfWeek)) { h.daysOfWeek = [0, 1, 2, 3, 4, 5, 6]; changed = true; }
            if (h.reminderTime === undefined) { h.reminderTime = null; changed = true; }
            if (changed) cursor.update(h);
            cursor.continue();
          };
        }
      };
    });
    return dbPromise;
  }

  function tx(storeNames, mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const transaction = db.transaction(names, mode);
      const stores = {};
      names.forEach((n) => { stores[n] = transaction.objectStore(n); });
      let result;
      try {
        result = fn(stores, transaction);
      } catch (err) {
        try { transaction.abort(); } catch (_) {}
        reject(err);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('aborted'));
    }));
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  const DEFAULT_META = {
    xp: 0,
    level: 1,
    streakCurrent: 0,
    streakBest: 0,
    lastActiveDate: null,
    streakFreezeRemaining: 1,
    settings: {
      notificationsEnabled: false,
      pushEnabled: false,
      pinEnabled: false,
      pinHash: null,
      pinSalt: null,
      onboardingSeen: false
    }
  };

  function normalizeHabit(h) {
    if (!h || typeof h !== 'object') return h;
    return {
      ...h,
      schedule: h.schedule || 'daily',
      daysOfWeek: Array.isArray(h.daysOfWeek) ? h.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
      reminderTime: h.reminderTime != null && h.reminderTime !== '' ? h.reminderTime : null
    };
  }

  function dayOfWeek(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).getDay(); // 0=Sun
  }

  function isHabitDueOn(habit, dateStr) {
    const h = normalizeHabit(habit);
    const dow = dayOfWeek(dateStr);
    if (h.schedule === 'daily') return true;
    if (h.schedule === 'weekdays') return dow >= 1 && dow <= 5;
    if (h.schedule === 'custom') {
      return (h.daysOfWeek || []).map(Number).includes(dow);
    }
    return true;
  }

  function scheduleLabel(habit) {
    const h = normalizeHabit(habit);
    if (h.schedule === 'weekdays') return 'Weekdays';
    if (h.schedule === 'custom') {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = (h.daysOfWeek || []).slice().sort((a, b) => a - b);
      if (days.length === 7) return 'Daily';
      if (days.length === 0) return 'Custom';
      return days.map((d) => names[d]).join('·');
    }
    return 'Daily';
  }

  const OrbitDB = {
    uid,
    DEFAULT_META,
    normalizeHabit,
    isHabitDueOn,
    scheduleLabel,
    dayOfWeek,

    async init() {
      await openDB();
      const existing = await this.getMeta();
      if (!existing) {
        await this.setMeta({ ...DEFAULT_META });
      } else {
        // Soft-migrate meta.settings and habit fields for DBs already on v2 schema
        const settings = { ...DEFAULT_META.settings, ...(existing.settings || {}) };
        if (!existing.settings || Object.keys(existing.settings).length < Object.keys(DEFAULT_META.settings).length) {
          await this.updateMeta({ settings });
        }
        const habits = await this.getHabits({ includeArchived: true });
        for (const h of habits) {
          const n = normalizeHabit(h);
          if (h.schedule !== n.schedule || h.reminderTime !== n.reminderTime ||
              JSON.stringify(h.daysOfWeek) !== JSON.stringify(n.daysOfWeek)) {
            await this.updateHabit(h.id, {
              schedule: n.schedule,
              daysOfWeek: n.daysOfWeek,
              reminderTime: n.reminderTime
            });
          }
        }
      }
      return this;
    },

    async getHabits({ includeArchived = false } = {}) {
      return tx('habits', 'readonly', (stores) =>
        reqToPromise(stores.habits.getAll()).then((all) => {
          let list = (all || []).map(normalizeHabit);
          if (!includeArchived) list = list.filter((h) => !h.archived);
          list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.createdAt - b.createdAt);
          return list;
        })
      );
    },

    async getHabitsDueOn(dateStr) {
      const habits = await this.getHabits();
      return habits.filter((h) => isHabitDueOn(h, dateStr));
    },

    async addHabit(name, opts = {}) {
      const habits = await this.getHabits({ includeArchived: true });
      const schedule = opts.schedule || 'daily';
      let daysOfWeek = Array.isArray(opts.daysOfWeek) ? opts.daysOfWeek.map(Number) : [0, 1, 2, 3, 4, 5, 6];
      if (schedule === 'weekdays') daysOfWeek = [1, 2, 3, 4, 5];
      if (schedule === 'daily') daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
      const habit = normalizeHabit({
        id: uid(),
        name: String(name).trim().slice(0, 200),
        createdAt: Date.now(),
        archived: false,
        sortOrder: habits.length,
        schedule,
        daysOfWeek,
        reminderTime: opts.reminderTime || null
      });
      await tx('habits', 'readwrite', (stores) => { stores.habits.put(habit); });
      return habit;
    },

    async updateHabit(id, partial) {
      return tx('habits', 'readwrite', (stores) =>
        reqToPromise(stores.habits.get(id)).then((h) => {
          if (!h) return null;
          const next = normalizeHabit({ ...h, ...partial, id: h.id });
          if (partial.name != null) next.name = String(partial.name).trim().slice(0, 200);
          stores.habits.put(next);
          return next;
        })
      );
    },

    async deleteHabit(id) {
      await tx(['habits', 'completions'], 'readwrite', (stores) => {
        stores.habits.delete(id);
        const req = stores.completions.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          if (cursor.value.habitId === id) cursor.delete();
          cursor.continue();
        };
      });
    },

    completionKey(habitId, date) {
      return habitId + '|' + date;
    },

    async isHabitDone(habitId, date) {
      const id = this.completionKey(habitId, date);
      return tx('completions', 'readonly', (stores) =>
        reqToPromise(stores.completions.get(id)).then((row) => !!row)
      );
    },

    async setHabitDone(habitId, date, done) {
      const id = this.completionKey(habitId, date);
      return tx('completions', 'readwrite', (stores) =>
        reqToPromise(stores.completions.get(id)).then((existing) => {
          if (done) {
            if (existing) return false;
            stores.completions.put({ id, habitId, date, completedAt: Date.now() });
            return true;
          }
          if (!existing) return false;
          stores.completions.delete(id);
          return true;
        })
      );
    },

    async getCompletionsForDate(date) {
      return tx('completions', 'readonly', (stores) =>
        reqToPromise(stores.completions.getAll()).then((all) =>
          (all || []).filter((c) => c.date === date)
        )
      );
    },

    async getAllCompletions() {
      return tx('completions', 'readonly', (stores) =>
        reqToPromise(stores.completions.getAll()).then((all) => all || [])
      );
    },

    async getTasks() {
      return tx('tasks', 'readonly', (stores) =>
        reqToPromise(stores.tasks.getAll()).then((all) => {
          const list = all || [];
          list.sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            return (b.createdAt || 0) - (a.createdAt || 0);
          });
          return list;
        })
      );
    },

    async getTasksForDate(date) {
      const all = await this.getTasks();
      return all.filter((t) => {
        const due = t.dueDate || date;
        if (due === date) return true;
        if (!t.completed && due < date) return true;
        return false;
      });
    },

    async addTask(title, dueDate) {
      const task = {
        id: uid(),
        title: String(title).trim().slice(0, 500),
        dueDate: dueDate || null,
        completed: false,
        completedAt: null,
        createdAt: Date.now()
      };
      await tx('tasks', 'readwrite', (stores) => { stores.tasks.put(task); });
      return task;
    },

    async setTaskCompleted(id, completed) {
      return tx('tasks', 'readwrite', (stores) =>
        reqToPromise(stores.tasks.get(id)).then((task) => {
          if (!task || !!task.completed === !!completed) return null;
          task.completed = !!completed;
          task.completedAt = completed ? Date.now() : null;
          stores.tasks.put(task);
          return task;
        })
      );
    },

    async deleteTask(id) {
      await tx('tasks', 'readwrite', (stores) => { stores.tasks.delete(id); });
    },

    async getMeta() {
      return tx('meta', 'readonly', (stores) =>
        reqToPromise(stores.meta.get('state')).then((row) => (row ? row.value : null))
      );
    },

    async setMeta(value) {
      const merged = {
        ...DEFAULT_META,
        ...value,
        settings: { ...DEFAULT_META.settings, ...((value && value.settings) || {}) }
      };
      await tx('meta', 'readwrite', (stores) => {
        stores.meta.put({ key: 'state', value: merged });
      });
      return merged;
    },

    async updateMeta(partial) {
      const current = (await this.getMeta()) || { ...DEFAULT_META };
      const next = { ...current, ...partial };
      if (partial.settings) {
        next.settings = { ...DEFAULT_META.settings, ...(current.settings || {}), ...partial.settings };
      }
      return this.setMeta(next);
    },

    async getSettings() {
      const meta = (await this.getMeta()) || { ...DEFAULT_META };
      return { ...DEFAULT_META.settings, ...(meta.settings || {}) };
    },

    async updateSettings(partial) {
      const settings = await this.getSettings();
      return this.updateMeta({ settings: { ...settings, ...partial } });
    },

    async getActiveDates() {
      const [completions, tasks] = await Promise.all([
        this.getAllCompletions(),
        this.getTasks()
      ]);
      const dates = new Set();
      completions.forEach((c) => dates.add(c.date));
      tasks.forEach((t) => {
        if (t.completed && t.completedAt) {
          dates.add(OrbitDB.formatDate(new Date(t.completedAt)));
        }
      });
      return dates;
    },

    formatDate(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    },

    today() {
      return this.formatDate(new Date());
    },

    addDays(dateStr, delta) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + delta);
      return this.formatDate(dt);
    },

    async exportAll() {
      const [habits, tasks, completions, meta] = await Promise.all([
        this.getHabits({ includeArchived: true }),
        this.getTasks(),
        this.getAllCompletions(),
        this.getMeta()
      ]);
      return {
        version: 2,
        exportedAt: new Date().toISOString(),
        app: 'Orbit',
        habits,
        tasks,
        completions,
        meta
      };
    },

    async importAll(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid backup');
      if (data.app !== 'Orbit' || !Array.isArray(data.habits) || !Array.isArray(data.tasks) || !Array.isArray(data.completions)) {
        throw new Error('Not an Orbit backup');
      }
      const okId = (x) => x && typeof x === 'object' && (typeof x.id === 'string' || typeof x.id === 'number');
      const habits = data.habits.map(normalizeHabit);
      const tasks = data.tasks;
      const completions = data.completions;
      if (!habits.every(okId) || !tasks.every(okId) || !completions.every(okId)) {
        throw new Error('Backup has malformed records');
      }
      const metaIn = data.meta && typeof data.meta === 'object' ? data.meta : { ...DEFAULT_META };
      const meta = {
        ...DEFAULT_META,
        ...metaIn,
        settings: { ...DEFAULT_META.settings, ...(metaIn.settings || {}) }
      };

      await tx(['habits', 'tasks', 'completions', 'meta'], 'readwrite', (stores) => {
        stores.habits.clear();
        stores.tasks.clear();
        stores.completions.clear();
        stores.meta.clear();
        habits.forEach((h) => stores.habits.put(h));
        tasks.forEach((t) => stores.tasks.put(t));
        completions.forEach((c) => stores.completions.put(c));
        stores.meta.put({ key: 'state', value: meta });
      });
    },

    async resetAll() {
      await tx(['habits', 'tasks', 'completions', 'meta'], 'readwrite', (stores) => {
        stores.habits.clear();
        stores.tasks.clear();
        stores.completions.clear();
        stores.meta.clear();
        stores.meta.put({ key: 'state', value: { ...DEFAULT_META, settings: { ...DEFAULT_META.settings } } });
      });
    },

    /* —— PIN (casual lock) —— */
    async hashPin(pin, saltB64) {
      const enc = new TextEncoder();
      const salt = saltB64
        ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0))
        : crypto.getRandomValues(new Uint8Array(16));
      const data = new Uint8Array(salt.length + enc.encode(String(pin)).length);
      data.set(salt, 0);
      data.set(enc.encode(String(pin)), salt.length);
      const digest = await crypto.subtle.digest('SHA-256', data);
      const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
      const saltOut = btoa(String.fromCharCode(...salt));
      return { hash, salt: saltOut };
    },

    async setPin(pin) {
      const digits = String(pin || '').replace(/\D/g, '');
      if (digits.length < 4 || digits.length > 6) throw new Error('PIN must be 4–6 digits');
      const { hash, salt } = await this.hashPin(digits);
      await this.updateSettings({ pinEnabled: true, pinHash: hash, pinSalt: salt });
    },

    async clearPin() {
      await this.updateSettings({ pinEnabled: false, pinHash: null, pinSalt: null });
    },

    async verifyPin(pin) {
      const settings = await this.getSettings();
      if (!settings.pinEnabled || !settings.pinHash || !settings.pinSalt) return true;
      const { hash } = await this.hashPin(String(pin).replace(/\D/g, ''), settings.pinSalt);
      return hash === settings.pinHash;
    }
  };

  global.OrbitDB = OrbitDB;
})(typeof window !== 'undefined' ? window : globalThis);
