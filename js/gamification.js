/**
 * Orbit gamification: XP, levels, daily %, streak + freeze recovery, weekly review
 */
(function (global) {
  'use strict';

  const XP_HABIT = 10;
  const XP_TASK = 15;
  const MAX_FREEZES = 1;

  function xpForLevel(level) {
    const n = Math.max(1, level);
    return Math.floor(100 * ((n - 1) * n) / 2);
  }

  function levelFromXp(xp) {
    let level = 1;
    while (xpForLevel(level + 1) <= xp) level += 1;
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
    if (!didActivity) return recomputeStreakFromHistory(meta);

    const today = activityDate || OrbitDB.today();
    const last = meta.lastActiveDate;
    let streakCurrent = meta.streakCurrent || 0;
    let streakBest = meta.streakBest || 0;
    let freezes = meta.streakFreezeRemaining != null ? meta.streakFreezeRemaining : MAX_FREEZES;

    if (!last) {
      streakCurrent = 1;
    } else if (last === today) {
      // already counted
    } else if (OrbitDB.addDays(last, 1) === today) {
      streakCurrent += 1;
    } else if (OrbitDB.addDays(last, 2) === today && freezes > 0) {
      freezes -= 1;
      streakCurrent += 1;
    } else {
      streakCurrent = 1;
      freezes = MAX_FREEZES;
    }

    if (streakCurrent > streakBest) streakBest = streakCurrent;
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

    if (!active.has(today)) cursor = OrbitDB.addDays(today, -1);

    for (let i = 0; i < maxLook; i++) {
      if (active.has(cursor)) {
        streak += 1;
        cursor = OrbitDB.addDays(cursor, -1);
        continue;
      }
      const freezesLeft = (meta.streakFreezeRemaining != null ? meta.streakFreezeRemaining : MAX_FREEZES);
      if (freezesUsed < 1 && freezesLeft >= 0 && streak > 0) {
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

  async function dailyCompletionPct(date) {
    const day = date || OrbitDB.today();
    const habits = await OrbitDB.getHabitsDueOn(day);
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

  /**
   * Weekly review: last 7 days completion %, best day, most-missed habits,
   * estimated XP from completions this week, streak status.
   */
  async function weeklyReview() {
    const today = OrbitDB.today();
    const meta = (await OrbitDB.getMeta()) || { ...OrbitDB.DEFAULT_META };
    const allHabits = await OrbitDB.getHabits({ includeArchived: true });
    const habitById = new Map(allHabits.map((h) => [h.id, h]));

    const dayStats = [];
    let xpWeek = 0;
    const missCount = new Map(); // habitId -> misses when due

    for (let i = 6; i >= 0; i--) {
      const d = OrbitDB.addDays(today, -i);
      const due = await OrbitDB.getHabitsDueOn(d);
      // getHabitsDueOn only returns non-archived; for past days also check archived that existed
      const completions = await OrbitDB.getCompletionsForDate(d);
      const doneSet = new Set(completions.map((c) => c.habitId));
      const tasks = await OrbitDB.getTasks();
      const tasksDoneThatDay = tasks.filter((t) => {
        if (!t.completed || !t.completedAt) return false;
        return OrbitDB.formatDate(new Date(t.completedAt)) === d;
      });

      const habitDone = due.filter((h) => doneSet.has(h.id)).length;
      const habitTotal = due.length;
      const taskDone = tasksDoneThatDay.length;
      // For daily % use tasks that were due that day (approx: completed that day + open due that day)
      const tasksForDay = tasks.filter((t) => {
        const dueDate = t.dueDate || d;
        if (dueDate === d) return true;
        if (t.completed && t.completedAt && OrbitDB.formatDate(new Date(t.completedAt)) === d) return true;
        return false;
      });
      const taskTotal = Math.max(tasksForDay.length, taskDone);
      const total = habitTotal + taskTotal;
      const done = habitDone + taskDone;
      const pct = total === 0 ? null : Math.round((done / total) * 100);

      xpWeek += habitDone * XP_HABIT + taskDone * XP_TASK;

      due.forEach((h) => {
        if (!doneSet.has(h.id)) {
          missCount.set(h.id, (missCount.get(h.id) || 0) + 1);
        }
      });

      const [y, m, day] = d.split('-').map(Number);
      const dt = new Date(y, m - 1, day);
      dayStats.push({
        date: d,
        label: dt.toLocaleDateString(undefined, { weekday: 'short' }),
        pct,
        done,
        total,
        habitDone,
        habitTotal
      });
    }

    const withPct = dayStats.filter((d) => d.pct != null);
    const avgPct = withPct.length
      ? Math.round(withPct.reduce((s, d) => s + d.pct, 0) / withPct.length)
      : null;
    let bestDay = null;
    withPct.forEach((d) => {
      if (!bestDay || d.pct > bestDay.pct) bestDay = d;
    });

    const mostMissed = Array.from(missCount.entries())
      .map(([id, misses]) => ({
        id,
        name: (habitById.get(id) && habitById.get(id).name) || 'Habit',
        misses
      }))
      .sort((a, b) => b.misses - a.misses)
      .slice(0, 5);

    return {
      dayStats,
      avgPct,
      bestDay,
      mostMissed,
      xpWeek,
      streakCurrent: meta.streakCurrent || 0,
      streakBest: meta.streakBest || 0,
      freezes: meta.streakFreezeRemaining != null ? meta.streakFreezeRemaining : MAX_FREEZES
    };
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
    recomputeStreakFromHistory,
    weeklyReview
  };
})(typeof window !== 'undefined' ? window : globalThis);
