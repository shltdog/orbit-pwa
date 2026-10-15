/**
 * Orbit IndexedDB wrapper
 * Stores: habits, tasks, completions, meta
 */
(function (global) {
  'use strict';

  const DB_NAME = 'orbit-db';
  const DB_VERSION = 1;

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
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
    settings: {}
  };

  const OrbitDB = {
    uid,
    DEFAULT_META,

    async init() {
      await openDB();
      const existing = await this.getMeta();
      if (!existing) {
        await this.setMeta({ ...DEFAULT_META });
      }
      return this;
    },

    async getHabits({ includeArchived = false } = {}) {
      return tx('habits', 'readonly', (stores) =>
        reqToPromise(stores.habits.getAll()).then((all) => {
          let list = all || [];
          if (!includeArchived) list = list.filter((h) => !h.archived);
          list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.createdAt - b.createdAt);
          return list;
        })
      );
    },

    async addHabit(name) {
      const habits = await this.getHabits({ includeArchived: true });
      const habit = {
        id: uid(),
        name: String(name).trim(),
        createdAt: Date.now(),
        archived: false,
        sortOrder: habits.length
      };
      await tx('habits', 'readwrite', (stores) => { stores.habits.put(habit); });
      return habit;
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
      if (done) {
        const row = { id, habitId, date, completedAt: Date.now() };
        await tx('completions', 'readwrite', (stores) => { stores.completions.put(row); });
        return row;
      }
      await tx('completions', 'readwrite', (stores) => { stores.completions.delete(id); });
      return null;
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
        title: String(title).trim(),
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
          if (!task) return null;
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
      const merged = { ...DEFAULT_META, ...value };
      await tx('meta', 'readwrite', (stores) => {
        stores.meta.put({ key: 'state', value: merged });
      });
      return merged;
    },

    async updateMeta(partial) {
      const current = (await this.getMeta()) || { ...DEFAULT_META };
      return this.setMeta({ ...current, ...partial });
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
        version: 1,
        exportedAt: new Date().toISOString(),
        app: 'Orbit',
        habits,
        tasks,
        completions,
        meta
      };
    },

    async importAll(data) {
      if (!data || typeof data !== 'object') throw new Error('Invalid backup');
      const habits = Array.isArray(data.habits) ? data.habits : [];
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      const completions = Array.isArray(data.completions) ? data.completions : [];
      const meta = data.meta && typeof data.meta === 'object' ? data.meta : { ...DEFAULT_META };

      await tx(['habits', 'tasks', 'completions', 'meta'], 'readwrite', (stores) => {
        stores.habits.clear();
        stores.tasks.clear();
        stores.completions.clear();
        stores.meta.clear();
        habits.forEach((h) => stores.habits.put(h));
        tasks.forEach((t) => stores.tasks.put(t));
        completions.forEach((c) => stores.completions.put(c));
        stores.meta.put({ key: 'state', value: { ...DEFAULT_META, ...meta } });
      });
    },

    async resetAll() {
      await tx(['habits', 'tasks', 'completions', 'meta'], 'readwrite', (stores) => {
        stores.habits.clear();
        stores.tasks.clear();
        stores.completions.clear();
        stores.meta.clear();
        stores.meta.put({ key: 'state', value: { ...DEFAULT_META } });
      });
    }
  };

  global.OrbitDB = OrbitDB;
})(typeof window !== 'undefined' ? window : globalThis);
