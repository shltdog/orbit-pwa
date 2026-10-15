/**
 * Orbit gamification: XP, levels, daily %, streak + freeze recovery
 */
(function (global) {
  'use strict';

  const XP_HABIT = 10;
  const XP_TASK = 15;
  const MAX_FREEZES = 1;

  /** Total XP required to reach the start of level N (level 1 = 0). */
  function xpForLevel(level) {
    // Level N starts at sum_{i=1}^{N-1} (i * 100) = 100 * (N-1)*N/2
    const n = Math.max(1, level);
    return Math.floor(100 * ((n - 1) * n) / 2);
  }

  function levelFromXp(xp) {
    let level = 1;
    while (xpForLevel(level + 1) <= xp) level += 1;
    // Cap display at something sane; no feature locks
    return level;
  }

  function progressInLevel(xp) {
    const level = levelFromXp(xp);
    const start = xpForLevel(level);
    const next = xpForLevel(level + 1);
    const span = next - start;
    const into = xp - start;
    return {
      level,
      xp,
      into,
      span,
      next,
      pct: span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 100
    };
  }

  /**
   * Award XP and refresh streak for an activity day.
   * Call after a meaningful completion (habit or task done).
   */
  async function awardXp(amount, activityDate) {
    const meta = (await OrbitDB.getMeta()) || { ...OrbitDB.DEFAULT_META };
    const prevLevel = levelFromXp(meta.xp || 0);
    const newXp = (meta.xp || 0) + amount;
    const newLevel = levelFromXp(newXp);

    const streakUpdate = await computeStreakUpdate(meta, activityDate, true);

    const updated = await OrbitDB.updateMeta({
      xp: newXp,
      level: newLevel,
      ...streakUpdate
    });

    return {
      meta: updated,
      gained: amount,
      leveledUp: newLevel > prevLevel,
      progress: progressInLevel(newXp)
    };
  }

  /**
   * When unchecking, optionally remove XP (keep simple: subtract same amount, floor 0).
   * Streak is recomputed from activity dates rather than rewound blindly.
   */
  async function revokeXp(amount) {
    const meta = (await OrbitDB.getMeta()) || { ...OrbitDB.DEFAULT_META };
    const newXp = Math.max(0, (meta.xp || 0) - amount);
    const newLevel = levelFromXp(newXp);
    const streakUpdate = await recomputeStreakFromHistory(meta);
    const updated = await OrbitDB.updateMeta({
      xp: newXp,
      level: newLevel,
      ...streakUpdate
    });
    return { meta: updated, progress: progressInLevel(newXp) };
  }

  async function computeStreakUpdate(meta, activityDate, didActivity) {
    if (!didActivity) {
      return recomputeStreakFromHistory(meta);
    }

    const today = activityDate || OrbitDB.today();
    const last = meta.lastActiveDate;
    let streakCurrent = meta.streakCurrent || 0;
    let streakBest = meta.streakBest || 0;
    let freezes = meta.streakFreezeRemaining != null ? meta.streakFreezeRemaining : MAX_FREEZES;

    if (!last) {
      streakCurrent = 1;
    } else if (last === today) {
      // already counted today
    } else if (OrbitDB.addDays(last, 1) === today) {
      streakCurrent += 1;
    } else if (OrbitDB.addDays(last, 2) === today && freezes > 0) {
      // one miss covered by freeze
      freezes -= 1;
      streakCurrent += 1;
    } else {
      // gap too large — reset, restore a freeze for the new run
      streakCurrent = 1;
      freezes = MAX_FREEZES;
    }

    if (streakCurrent > streakBest) streakBest = streakCurrent;

    // Soft restore: after a successful active day, if freezes empty and streak >= 3, refill 1
    if (freezes < MAX_FREEZES && streakCurrent >= 3 && last !== today) {
      freezes = Math.min(MAX_FREEZES, freezes + 1);
    }

    return {
      streakCurrent,
      streakBest,
      lastActiveDate: today,
      streakFreezeRemaining: freezes
    };
  }

  async function recomputeStreakFromHistory(meta) {
    const active = await OrbitDB.getActiveDates();
    const today = OrbitDB.today();
    let streak = 0;
    let cursor = today;
    let freezesUsed = 0;
    const maxLook = 400;

    // If today not active, start from yesterday (streak still "alive" until day ends)
    if (!active.has(today)) {
      cursor = OrbitDB.addDays(today, -1);
    }

    for (let i = 0; i < maxLook; i++) {
      if (active.has(cursor)) {
        streak += 1;
        cursor = OrbitDB.addDays(cursor, -1);
        continue;
      }
      // allow one freeze gap if we still have freezes in meta accounting
      const freezesLeft = (meta.streakFreezeRemaining != null ? meta.streakFreezeRemaining : MAX_FREEZES);
      if (freezesUsed < 1 && freezesLeft >= 0 && streak > 0) {
        // check if day before gap was active (classic freeze: skip one empty day)
        const before = OrbitDB.addDays(cursor, -1);
        if (active.has(before)) {
          freezesUsed += 1;
          cursor = before;
          continue;
        }
      }
      break;
    }

    const streakBest = Math.max(meta.streakBest || 0, streak);
    let lastActiveDate = meta.lastActiveDate;
    // find most recent active
    let scan = today;
    for (let i = 0; i < maxLook; i++) {
      if (active.has(scan)) {
        lastActiveDate = scan;
        break;
      }
      scan = OrbitDB.addDays(scan, -1);
    }

    return {
      streakCurrent: streak,
      streakBest,
      lastActiveDate: lastActiveDate || null,
      streakFreezeRemaining: meta.streakFreezeRemaining != null ? meta.streakFreezeRemaining : MAX_FREEZES
    };
  }

  /**
   * Daily completion % = completed today / (habits + tasks due today)
   */
  async function dailyCompletionPct(date) {
    const day = date || OrbitDB.today();
    const habits = await OrbitDB.getHabits();
    const tasks = await OrbitDB.getTasksForDate(day);
    const completions = await OrbitDB.getCompletionsForDate(day);
    const doneHabits = new Set(completions.map((c) => c.habitId));

    const habitTotal = habits.length;
    const habitDone = habits.filter((h) => doneHabits.has(h.id)).length;
    const taskTotal = tasks.length;
    const taskDone = tasks.filter((t) => t.completed).length;

    const total = habitTotal + taskTotal;
    if (total === 0) return { pct: null, done: 0, total: 0, habitDone, habitTotal, taskDone, taskTotal };

    const done = habitDone + taskDone;
    return {
      pct: Math.round((done / total) * 100),
      done,
      total,
      habitDone,
      habitTotal,
      taskDone,
      taskTotal
    };
  }

  async function last7DayActivity() {
    const active = await OrbitDB.getActiveDates();
    const today = OrbitDB.today();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = OrbitDB.addDays(today, -i);
      const [y, m, day] = d.split('-').map(Number);
      const dt = new Date(y, m - 1, day);
      days.push({
        date: d,
        active: active.has(d),
        isToday: d === today,
        label: dt.toLocaleDateString(undefined, { weekday: 'narrow' })
      });
    }
    return days;
  }

  global.OrbitGame = {
    XP_HABIT,
    XP_TASK,
    MAX_FREEZES,
    xpForLevel,
    levelFromXp,
    progressInLevel,
    awardXp,
    revokeXp,
    dailyCompletionPct,
    last7DayActivity,
    recomputeStreakFromHistory
  };
})(typeof window !== 'undefined' ? window : globalThis);
