/**
 * Orbit UI — Today, Progress, Settings, lock, presets, share
 */
(function () {
  'use strict';

  const use = (n, sz) => '<svg class="ic" width="' + sz + '" height="' + sz + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
  const CHECK_SVG = '<svg class="ic check-ic" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path class="check-path" d="M5 12.5l4.5 4.5L19 7.5" pathLength="1"/></svg>';
  const TRASH_SVG = use('trash', 18);
  const EDIT_SVG = use('edit', 16);
  const VIEWS = ['today', 'progress', 'profile', 'settings'];
  let currentView = 'today';
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const PRESETS = {
    morning: {
      label: 'Morning check-in',
      habits: [
        { name: 'Hydrate', schedule: 'daily' },
        { name: 'Stretch', schedule: 'daily' },
        { name: 'Plan the day', schedule: 'weekdays' }
      ]
    },
    evening: {
      label: 'Evening wind-down',
      habits: [
        { name: 'Review the day', schedule: 'daily' },
        { name: 'Prep tomorrow', schedule: 'weekdays' },
        { name: 'Screens off', schedule: 'daily', reminderTime: '21:30' }
      ]
    }
  };

  let captureType = 'task';
  let toastTimer = null;
  let unlocked = false;
  let editingHabitId = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function haptic(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern || 12);
    } catch (_) { /* ignore */ }
  }

  function showToast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 220);
    }, 1800);
  }

  function formatHeaderDate(d = new Date()) {
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  function moveIndicator(name) {
    const ind = document.querySelector('.nav-indicator');
    const idx = VIEWS.indexOf(name);
    if (ind && idx >= 0) ind.style.transform = 'translateX(' + (idx * 100) + '%)';
  }

  function switchView(name) {
    if (name === currentView) return;
    const fromIdx = VIEWS.indexOf(currentView);
    const toIdx = VIEWS.indexOf(name);
    const dir = toIdx > fromIdx ? 1 : -1;
    const prev = $('#view-' + currentView);
    const next = $('#view-' + name);
    currentView = name;
    $$('.nav-btn').forEach((btn) => {
      const on = btn.dataset.view === name;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    moveIndicator(name);
    if (name === 'progress') { renderProgress(); renderWeeklyReview(); }
    if (name === 'profile') renderProfile();
    if (name === 'settings') renderSettings();

    $$('.view').forEach((v) => { if (v !== prev && v !== next) { v.hidden = true; v.classList.remove('view-active', 'view-leave'); } });
    if (prev) { prev.classList.remove('view-active'); prev.hidden = true; }
    if (next) {
      next.style.setProperty('--dir', String(dir));
      next.hidden = false;
      next.classList.remove('view-active');
      void next.offsetWidth; // restart animation
      next.classList.add('view-active');
      if (!reducedMotion()) staggerIn(next);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function staggerIn(root) {
    const items = root.querySelectorAll('.item-card, .stat-card, .profile-hero, .capture-bar');
    items.forEach((el, i) => {
      el.style.setProperty('--i', String(Math.min(i, 10)));
      el.classList.remove('stagger');
      void el.offsetWidth;
      el.classList.add('stagger');
    });
  }

  function flyXp(fromEl, amount) {
    if (!fromEl || reducedMotion()) return;
    const layer = $('#xp-fly-layer');
    if (!layer) return;
    const r = fromEl.getBoundingClientRect();
    const chip = document.createElement('div');
    chip.className = 'xp-fly';
    chip.innerHTML = use('xp', 14) + '<span>+' + amount + ' XP</span>';
    chip.style.left = (r.right - 90) + 'px';
    chip.style.top = (r.top + r.height / 2 - 14) + 'px';
    layer.appendChild(chip);
    chip.addEventListener('animationend', () => chip.remove());
    setTimeout(() => chip.remove(), 1200);
  }

  async function renderToday() {
    const today = OrbitDB.today();
    $('#today-date').textContent = formatHeaderDate();

    const habits = await OrbitDB.getHabitsDueOn(today);
    const allHabits = await OrbitDB.getHabits();
    const tasks = await OrbitDB.getTasksForDate(today);
    const completions = await OrbitDB.getCompletionsForDate(today);
    const doneSet = new Set(completions.map((c) => c.habitId));

    const habitsList = $('#habits-list');
    const habitsEmpty = $('#habits-empty');
    const onboarding = $('#onboarding-card');
    const presetsRow = $('#presets-row');
    habitsList.innerHTML = '';

    const showEmptyOnboarding = allHabits.length === 0 && tasks.length === 0;
    if (onboarding) onboarding.classList.toggle('hidden', !showEmptyOnboarding);
    if (presetsRow) presetsRow.classList.toggle('hidden', allHabits.length > 0 && !showEmptyOnboarding);

    if (habits.length === 0) {
      habitsEmpty.classList.remove('hidden');
      habitsEmpty.textContent = allHabits.length === 0
        ? 'No habits yet. Add one or try a Morning / Evening preset.'
        : 'No habits due today — enjoy the lighter schedule.';
    } else {
      habitsEmpty.classList.add('hidden');
      habits.forEach((h) => {
        habitsList.appendChild(makeHabitCard(h, doneSet.has(h.id)));
      });
    }

    const tasksList = $('#tasks-list');
    const tasksEmpty = $('#tasks-empty');
    tasksList.innerHTML = '';

    if (tasks.length === 0) {
      tasksEmpty.classList.remove('hidden');
    } else {
      tasksEmpty.classList.add('hidden');
      tasks.forEach((t) => tasksList.appendChild(makeTaskCard(t, today)));
    }

    // Not due today but exist — small note
    const notDue = allHabits.filter((h) => !OrbitDB.isHabitDueOn(h, today));
    const skipEl = $('#habits-skipped');
    if (skipEl) {
      if (notDue.length) {
        skipEl.classList.remove('hidden');
        skipEl.textContent = notDue.length + ' habit' + (notDue.length > 1 ? 's' : '') + ' not scheduled today';
      } else {
        skipEl.classList.add('hidden');
      }
    }
  }

  function makeHabitCard(habit, done) {
    const li = document.createElement('li');
    li.className = 'item-card' + (done ? ' completed' : '');
    li.dataset.id = habit.id;
    const metaParts = [OrbitDB.scheduleLabel(habit)];
    if (habit.reminderTime) metaParts.push('Reminds ' + habit.reminderTime);
    li.innerHTML =
      '<div class="check" aria-hidden="true">' + CHECK_SVG + '</div>' +
      '<div class="item-body"><p class="item-title"></p><p class="item-meta"></p></div>' +
      '<button type="button" class="item-edit" aria-label="Edit habit">' + EDIT_SVG + '</button>' +
      '<button type="button" class="item-delete" aria-label="Delete habit">' + TRASH_SVG + '</button>';
    li.querySelector('.item-title').textContent = habit.name;
    li.querySelector('.item-meta').textContent = metaParts.join(' · ');

    li.addEventListener('click', async (e) => {
      if (e.target.closest('.item-delete') || e.target.closest('.item-edit')) return;
      await toggleHabit(habit.id, !done, li);
    });

    li.querySelector('.item-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openHabitEditor(habit);
    });

    li.querySelector('.item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete habit "' + habit.name + '"?')) return;
      await OrbitDB.deleteHabit(habit.id);
      await OrbitReminders.syncRemindersToSW();
      await renderToday();
      showToast('Habit removed');
    });

    return li;
  }

  function makeTaskCard(task, today) {
    const li = document.createElement('li');
    li.className = 'item-card' + (task.completed ? ' completed' : '');
    li.dataset.id = task.id;
    const due = task.dueDate || today;
    const overdue = !task.completed && due < today;
    const meta = overdue ? 'Overdue · ' + due : (task.dueDate ? 'Due ' + due : 'Today');
    li.innerHTML =
      '<div class="check" aria-hidden="true">' + CHECK_SVG + '</div>' +
      '<div class="item-body"><p class="item-title"></p><p class="item-meta"></p></div>' +
      '<button type="button" class="item-delete" aria-label="Delete task">' + TRASH_SVG + '</button>';
    li.querySelector('.item-title').textContent = task.title;
    li.querySelector('.item-meta').textContent = meta;

    li.addEventListener('click', async (e) => {
      if (e.target.closest('.item-delete')) return;
      await toggleTask(task.id, !task.completed, li);
    });

    li.querySelector('.item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete task?')) return;
      await OrbitDB.deleteTask(task.id);
      await renderToday();
      showToast('Task removed');
    });

    return li;
  }

  const busy = new Set();
  const wait = (ms) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

  async function toggleHabit(id, done, el) {
    if (busy.has(id)) return;
    busy.add(id);
    try {
      const today = OrbitDB.today();
      const changed = await OrbitDB.setHabitDone(id, today, done);
      if (!changed) {
        // no-op
      } else if (done) {
        el.classList.add('completed', 'just-done');
        haptic([10, 30, 18]);
        flyXp(el, OrbitGame.XP_HABIT);
        const result = await OrbitGame.awardXp(OrbitGame.XP_HABIT, today);
        showToast('+' + result.gained + ' XP' + (result.leveledUp ? ' · Level up!' : ''));
        await OrbitReminders.syncRemindersToSW();
        await wait(380);
      } else {
        el.classList.remove('completed', 'just-done');
        haptic(8);
        await OrbitGame.revokeXp(OrbitGame.XP_HABIT);
        showToast('Undone');
        await OrbitReminders.syncRemindersToSW();
      }
      await renderToday();
    } finally { busy.delete(id); }
  }

  async function toggleTask(id, done, el) {
    if (busy.has(id)) return;
    busy.add(id);
    try {
      const today = OrbitDB.today();
      const changed = await OrbitDB.setTaskCompleted(id, done);
      if (!changed) {
        // no-op
      } else if (done) {
        el.classList.add('completed', 'just-done');
        haptic([10, 30, 18]);
        flyXp(el, OrbitGame.XP_TASK);
        const result = await OrbitGame.awardXp(OrbitGame.XP_TASK, today);
        showToast('+' + result.gained + ' XP' + (result.leveledUp ? ' · Level up!' : ''));
        await wait(380);
      } else {
        el.classList.remove('completed', 'just-done');
        haptic(8);
        await OrbitGame.revokeXp(OrbitGame.XP_TASK);
        showToast('Undone');
      }
      await renderToday();
    } finally { busy.delete(id); }
  }

  async function renderProgress() {
    const meta = (await OrbitDB.getMeta()) || { ...OrbitDB.DEFAULT_META };
    const prog = OrbitGame.progressInLevel(meta.xp || 0);
    const daily = await OrbitGame.dailyCompletionPct();
    const week = await OrbitGame.last7DayActivity();

    $('#stat-level').textContent = String(prog.level);
    $('#stat-xp').textContent = String(prog.xp);
    $('#xp-bar-fill').style.width = prog.pct + '%';
    $('#xp-bar').setAttribute('aria-valuenow', String(prog.pct));
    $('#xp-to-next').textContent = (prog.next - prog.xp) + ' XP to level ' + (prog.level + 1);

    $('#stat-streak').textContent = String(meta.streakCurrent || 0);
    $('#stat-best').textContent = String(meta.streakBest || 0);
    $('#stat-freezes').textContent = String(
      meta.streakFreezeRemaining != null ? meta.streakFreezeRemaining : OrbitGame.MAX_FREEZES
    );
    $('#stat-today-pct').textContent = daily.pct == null ? '—' : daily.pct + '%';

    const weekEl = $('#week-dots');
    weekEl.innerHTML = '';
    week.forEach((d) => {
      const cell = document.createElement('div');
      cell.className = 'week-dot' + (d.active ? ' active' : '') + (d.isToday ? ' today' : '') + (d.isFuture ? ' future' : '');
      cell.innerHTML = '<div class="dot"></div><span class="dow"></span>';
      cell.querySelector('.dow').textContent = d.label;
      cell.title = d.date + (d.active ? ' · active' : '');
      weekEl.appendChild(cell);
    });
  }

  async function renderWeeklyReview() {
    const el = $('#weekly-review');
    if (!el) return;
    const w = await OrbitGame.weeklyReview();
    const avg = w.avgPct == null ? '—' : w.avgPct + '%';
    const best = w.bestDay
      ? w.bestDay.label + ' · ' + w.bestDay.pct + '%'
      : '—';
    const missed = w.mostMissed.length
      ? w.mostMissed.map((m) => m.name + ' (' + m.misses + ')').join(', ')
      : 'None — nice week';
    el.innerHTML =
      '<p class="stat-label">Weekly review</p>' +
      '<div class="review-grid">' +
      '<div><p class="stat-hint">Avg complete</p><p class="stat-value">' + avg + '</p></div>' +
      '<div><p class="stat-hint">Best day</p><p class="stat-value">' + escapeHtml(best) + '</p></div>' +
      '<div><p class="stat-hint">XP this week</p><p class="stat-value">~' + w.xpWeek + '</p></div>' +
      '<div><p class="stat-hint">Streak</p><p class="stat-value">' + w.streakCurrent + ' · best ' + w.streakBest + '</p></div>' +
      '</div>' +
      '<p class="stat-hint review-missed"><strong>Most missed:</strong> ' + escapeHtml(missed) + '</p>' +
      '<div class="week-bars" aria-label="Daily completion">' +
      w.dayStats.map((d) => {
        const h = d.pct == null ? 4 : Math.max(8, Math.round((d.pct / 100) * 48));
        return '<div class="week-bar' + (d.isFuture ? ' future' : '') + (d.isToday ? ' today' : '') + '" title="' + d.date + ': ' + (d.pct == null ? 'n/a' : d.pct + '%') + '">' +
          '<div class="week-bar-fill" style="height:' + h + 'px"></div>' +
          '<span>' + escapeHtml(d.label) + '</span></div>';
      }).join('') +
      '</div>';
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'O';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  async function renderProfile() {
    const meta = (await OrbitDB.getMeta()) || { ...OrbitDB.DEFAULT_META };
    const prog = OrbitGame.progressInLevel(meta.xp || 0);
    const rank = OrbitGame.rankFor(prog.level);
    const life = await OrbitGame.lifetimeStats();
    const week = await OrbitGame.last7DayActivity();
    const name = meta.displayName || 'Orbiter';

    $('#profile-name').textContent = name;
    $('#profile-avatar').textContent = initials(name);
    $('#profile-level-badge').textContent = String(prog.level);
    $('#profile-rank').textContent = rank.name;
    $('#profile-rank-tier').textContent = 'Tier ' + rank.tier + ' of ' + rank.total;
    document.querySelector('.profile-hero').style.setProperty('--tier', String(rank.index));
    $('#avatar-ring-fill').style.strokeDashoffset = String(100 - prog.pct);
    $('#profile-xp-fill').style.width = prog.pct + '%';
    $('#profile-xp-bar').setAttribute('aria-valuenow', String(prog.pct));
    $('#profile-xp-total').textContent = prog.xp.toLocaleString() + ' XP';
    $('#profile-xp-next').textContent = (prog.next - prog.xp) + ' to Lv ' + (prog.level + 1);
    $('#profile-next-rank').textContent = rank.next
      ? 'Next rank: ' + rank.next.name + ' at Level ' + rank.next.min
      : 'Apex reached — the summit is yours.';

    $('#rank-ladder').innerHTML = OrbitGame.RANKS.map((r, i) =>
      '<span class="rung' + (i < rank.index ? ' done' : '') + (i === rank.index ? ' current' : '') +
      '" title="' + escapeHtml(r.name + ' · Lv ' + r.min) + '"></span>').join('');

    $('#pf-streak').textContent = String(meta.streakCurrent || 0);
    $('#pf-best').textContent = String(meta.streakBest || 0);
    $('#pf-freeze').textContent = String(meta.streakFreezeRemaining != null ? meta.streakFreezeRemaining : OrbitGame.MAX_FREEZES);
    $('#pf-habits').textContent = String(life.habitsDone);
    $('#pf-tasks').textContent = String(life.tasksDone);
    $('#pf-bestday').textContent = life.bestDay ? life.bestDay.count + ' done' : '—';
    $('#pf-consistency').textContent = life.consistency == null ? '—' : life.consistency + '%';

    $('#pf-week').innerHTML = week.map((d) =>
      '<div class="ws' + (d.active ? ' active' : '') + (d.isToday ? ' today' : '') + (d.isFuture ? ' future' : '') + '">' +
      '<span class="ws-cell">' + (d.active ? use('check', 12) : '') + '</span><span class="ws-dow">' + d.label + '</span></div>').join('');
  }

  function bindProfile() {
    const nameBtn = $('#profile-name');
    nameBtn && nameBtn.addEventListener('click', async () => {
      const meta = (await OrbitDB.getMeta()) || {};
      const v = prompt('Display name (stays on this device):', meta.displayName || '');
      if (v == null) return;
      await OrbitDB.updateMeta({ displayName: v.trim().slice(0, 40) });
      haptic(8);
      await renderProfile();
    });
    const shareBtn = $('#btn-share-profile');
    shareBtn && shareBtn.addEventListener('click', async () => {
      const meta = (await OrbitDB.getMeta()) || {};
      const lvl = OrbitGame.levelFromXp(meta.xp || 0);
      const rank = OrbitGame.rankFor(lvl);
      await doShare("I'm Level " + lvl + ' — ' + rank.name + ' on Orbit. Build your own private streak:');
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function onCapture(e) {
    e.preventDefault();
    const input = $('#capture-input');
    const text = (input.value || '').trim();
    if (!text) return;

    if (captureType === 'habit') {
      const schedule = ($('#habit-schedule') && $('#habit-schedule').value) || 'daily';
      const reminderTime = ($('#habit-reminder') && $('#habit-reminder').value) || null;
      const days = getCustomDays();
      await OrbitDB.addHabit(text, {
        schedule,
        daysOfWeek: schedule === 'custom' ? days : undefined,
        reminderTime: reminderTime || null
      });
      showToast('Habit added');
      haptic(10);
      await OrbitReminders.syncRemindersToSW();
    } else {
      await OrbitDB.addTask(text, OrbitDB.today());
      showToast('Task added');
      haptic(10);
    }
    input.value = '';
    input.blur();
    await renderToday();
  }

  function getCustomDays() {
    return $$('.day-chip.active').map((el) => Number(el.dataset.day));
  }

  function bindCaptureType() {
    $$('.type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        captureType = btn.dataset.type;
        $$('.type-btn').forEach((b) => b.classList.toggle('active', b === btn));
        $('#capture-input').placeholder =
          captureType === 'habit' ? 'New habit…' : 'Add a task…';
        const opts = $('#habit-options');
        if (opts) opts.classList.toggle('hidden', captureType !== 'habit');
      });
    });

    const sched = $('#habit-schedule');
    if (sched) {
      sched.addEventListener('change', () => {
        const custom = $('#custom-days');
        if (custom) custom.classList.toggle('hidden', sched.value !== 'custom');
      });
    }

    $$('.day-chip').forEach((chip) => {
      chip.addEventListener('click', () => chip.classList.toggle('active'));
    });
  }

  function bindNav() {
    $$('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
  }

  function bindBackup() {
    $('#btn-export').addEventListener('click', async () => {
      const data = await OrbitDB.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'orbit-backup-' + OrbitDB.today() + '.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported');
    });

    $('#btn-import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!confirm('Import will replace all Orbit data on this device. Continue?')) return;
        await OrbitDB.importAll(data);
        await renderToday();
        await renderProgress();
        await renderWeeklyReview();
        if (currentView === 'profile') await renderProfile();
        await OrbitReminders.syncRemindersToSW();
        showToast('Imported');
      } catch (err) {
        console.error(err);
        alert('Could not import that file. Need a valid Orbit JSON backup.');
      }
    });

    $('#btn-reset').addEventListener('click', async () => {
      if (!confirm('Reset ALL Orbit data on this device? This cannot be undone.')) return;
      await OrbitDB.resetAll();
      unlocked = true;
      hideLock();
      await renderToday();
      await renderProgress();
      await renderSettings();
      showToast('Reset complete');
    });
  }

  async function doShare(customText) {
    const url = OrbitReminders.appUrl();
    const payload = {
      title: 'Orbit',
      text: typeof customText === 'string' ? customText : 'Try Orbit — private offline habit tracker. Your data stays on your device.',
      url
    };
    try {
      if (navigator.share) {
        await navigator.share(payload);
      } else {
        await navigator.clipboard.writeText(url);
        showToast('Link copied');
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied');
      } catch (_) {
        prompt('Copy this Orbit link:', url);
      }
    }
  }

  function bindShare() {
    ['#btn-share', '#btn-share-onboarding', '#btn-share-settings'].forEach((sel) => {
      const btn = $(sel);
      if (btn) btn.addEventListener('click', () => doShare());
    });
  }

  function bindPresets() {
    $$('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.preset;
        const pack = PRESETS[key];
        if (!pack) return;
        for (const h of pack.habits) {
          await OrbitDB.addHabit(h.name, {
            schedule: h.schedule || 'daily',
            reminderTime: h.reminderTime || null
          });
        }
        haptic([8, 40, 12]);
        showToast(pack.label + ' added');
        await OrbitReminders.syncRemindersToSW();
        await renderToday();
      });
    });
    ['#btn-presets', '#btn-presets-toggle'].forEach((sel) => {
      const openPresets = $(sel);
      if (openPresets) {
        openPresets.addEventListener('click', () => {
          const row = $('#presets-row');
          if (row) row.classList.toggle('hidden');
        });
      }
    });
  }

  /* —— Habit editor modal —— */
  function openHabitEditor(habit) {
    editingHabitId = habit.id;
    const modal = $('#habit-modal');
    if (!modal) return;
    $('#edit-habit-name').value = habit.name;
    $('#edit-habit-schedule').value = habit.schedule || 'daily';
    $('#edit-habit-reminder').value = habit.reminderTime || '';
    $$('#edit-custom-days .day-chip').forEach((chip) => {
      const day = Number(chip.dataset.day);
      chip.classList.toggle('active', (habit.daysOfWeek || []).includes(day));
    });
    $('#edit-custom-days').classList.toggle('hidden', (habit.schedule || 'daily') !== 'custom');
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeHabitEditor() {
    editingHabitId = null;
    const modal = $('#habit-modal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }

  function bindHabitEditor() {
    const sched = $('#edit-habit-schedule');
    if (sched) {
      sched.addEventListener('change', () => {
        $('#edit-custom-days').classList.toggle('hidden', sched.value !== 'custom');
      });
    }
    $$('#edit-custom-days .day-chip').forEach((chip) => {
      chip.addEventListener('click', () => chip.classList.toggle('active'));
    });
    $('#habit-modal-cancel') && $('#habit-modal-cancel').addEventListener('click', closeHabitEditor);
    $('#habit-modal-backdrop') && $('#habit-modal-backdrop').addEventListener('click', closeHabitEditor);
    $('#habit-modal-save') && $('#habit-modal-save').addEventListener('click', async () => {
      if (!editingHabitId) return;
      const name = ($('#edit-habit-name').value || '').trim();
      if (!name) { alert('Name required'); return; }
      const schedule = $('#edit-habit-schedule').value;
      const reminderTime = ($('#edit-habit-reminder').value || '').trim() || null;
      const daysOfWeek = $$('#edit-custom-days .day-chip.active').map((c) => Number(c.dataset.day));
      if (schedule === 'custom' && daysOfWeek.length === 0) {
        alert('Pick at least one day');
        return;
      }
      await OrbitDB.updateHabit(editingHabitId, {
        name,
        schedule,
        daysOfWeek: schedule === 'custom' ? daysOfWeek : (schedule === 'weekdays' ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]),
        reminderTime
      });
      closeHabitEditor();
      await OrbitReminders.syncRemindersToSW();
      await renderToday();
      showToast('Habit updated');
    });
  }

  /* —— Settings —— */
  async function renderSettings() {
    const settings = await OrbitDB.getSettings();
    const perm = await OrbitReminders.notificationPermission();
    const notifBtn = $('#btn-enable-notifications');
    const notifStatus = $('#notif-status');
    if (notifStatus) {
      notifStatus.textContent =
        perm === 'unsupported' ? 'Not supported in this browser'
          : perm === 'granted' && settings.notificationsEnabled ? 'Local reminders on'
            : perm === 'denied' ? 'Blocked — enable in system settings'
              : 'Off — tap to enable';
    }
    if (notifBtn) {
      notifBtn.textContent = settings.notificationsEnabled && perm === 'granted'
        ? 'Disable local reminders'
        : 'Enable local reminders';
    }

    const pushSection = $('#push-section');
    if (pushSection) {
      pushSection.classList.toggle('hidden', !OrbitReminders.pushConfigured());
    }
    const pushStatus = $('#push-status');
    if (pushStatus) {
      pushStatus.textContent = settings.pushEnabled ? 'Push subscribed' : 'Push off';
    }
    const pushBtn = $('#btn-push');
    if (pushBtn) {
      pushBtn.textContent = settings.pushEnabled ? 'Disable push reminders' : 'Enable push reminders';
    }

    const pinStatus = $('#pin-status');
    if (pinStatus) {
      pinStatus.textContent = settings.pinEnabled
        ? 'Casual lock on (device-only)'
        : 'Off';
    }
    const pinBtn = $('#btn-pin');
    if (pinBtn) {
      pinBtn.textContent = settings.pinEnabled ? 'Remove PIN' : 'Set PIN (4–6 digits)';
    }
  }

  function bindSettings() {
    $('#btn-enable-notifications') && $('#btn-enable-notifications').addEventListener('click', async () => {
      const settings = await OrbitDB.getSettings();
      if (settings.notificationsEnabled) {
        await OrbitReminders.disableLocalNotifications();
        showToast('Reminders off');
      } else {
        const perm = await OrbitReminders.enableLocalNotifications();
        if (perm === 'granted') showToast('Reminders on');
        else if (perm === 'denied') alert('Notifications are blocked. Enable them in your device settings for this site.');
        else if (perm === 'unsupported') alert('Notifications are not supported here. Try the installed Home Screen app on a recent iOS/Safari.');
        else showToast('Permission: ' + perm);
      }
      await renderSettings();
    });

    $('#btn-push') && $('#btn-push').addEventListener('click', async () => {
      const settings = await OrbitDB.getSettings();
      try {
        if (settings.pushEnabled) {
          await OrbitReminders.unsubscribePush();
          showToast('Push off');
        } else {
          await OrbitReminders.subscribePush();
          showToast('Push on');
        }
      } catch (err) {
        alert(err.message || String(err));
      }
      await renderSettings();
    });

    $('#btn-pin') && $('#btn-pin').addEventListener('click', async () => {
      const settings = await OrbitDB.getSettings();
      if (settings.pinEnabled) {
        const pin = prompt('Enter current PIN to remove lock:');
        if (pin == null) return;
        if (!(await OrbitDB.verifyPin(pin))) {
          alert('Incorrect PIN');
          return;
        }
        await OrbitDB.clearPin();
        showToast('PIN removed');
      } else {
        const pin = prompt('Choose a 4–6 digit PIN (casual lock — not encryption):');
        if (pin == null) return;
        try {
          await OrbitDB.setPin(pin);
          const again = prompt('Confirm PIN:');
          if (!(await OrbitDB.verifyPin(again))) {
            await OrbitDB.clearPin();
            alert('PINs did not match');
            return;
          }
          showToast('PIN set');
        } catch (err) {
          alert(err.message || String(err));
        }
      }
      await renderSettings();
    });

    $('#btn-test-notif') && $('#btn-test-notif').addEventListener('click', async () => {
      const ok = await OrbitReminders.showLocal('Orbit', 'Test notification — reminders work when permission is granted.', 'orbit-test');
      showToast(ok ? 'Test sent' : 'Need permission first');
    });
  }

  /* —— PIN lock screen —— */
  function showLock() {
    const lock = $('#lock-screen');
    if (lock) {
      lock.hidden = false;
      lock.setAttribute('aria-hidden', 'false');
      const input = $('#lock-pin');
      if (input) { input.value = ''; setTimeout(() => input.focus(), 100); }
    }
  }

  function hideLock() {
    const lock = $('#lock-screen');
    if (lock) {
      lock.hidden = true;
      lock.setAttribute('aria-hidden', 'true');
    }
  }

  async function gateLock() {
    const settings = await OrbitDB.getSettings();
    if (!settings.pinEnabled) {
      unlocked = true;
      hideLock();
      return true;
    }
    if (unlocked) {
      hideLock();
      return true;
    }
    showLock();
    return false;
  }

  function bindLock() {
    const form = $('#lock-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = ($('#lock-pin').value || '').trim();
      if (await OrbitDB.verifyPin(pin)) {
        unlocked = true;
        hideLock();
        haptic(10);
      } else {
        haptic([30, 40, 30]);
        $('#lock-error').textContent = 'Incorrect PIN';
        $('#lock-pin').value = '';
      }
    });
  }

  async function boot() {
    await OrbitDB.init();
    bindCaptureType();
    bindNav();
    bindBackup();
    bindShare();
    bindPresets();
    bindHabitEditor();
    bindSettings();
    bindLock();
    bindProfile();
    $('#capture-form').addEventListener('submit', onCapture);

    const ok = await gateLock();
    if (ok) {
      await renderToday();
      if (!reducedMotion()) staggerIn($('#view-today'));
      await OrbitReminders.bootReminders();
    } else {
      // Still prepare UI behind lock
      await renderToday();
      const unlockWatcher = setInterval(async () => {
        if (unlocked) {
          clearInterval(unlockWatcher);
          await OrbitReminders.bootReminders();
        }
      }, 400);
    }

    const startView = (location.hash || '').replace('#', '');
    if (VIEWS.includes(startView)) switchView(startView);

    let lastDay = OrbitDB.today();
    const checkDay = () => {
      const d = OrbitDB.today();
      if (d !== lastDay) {
        lastDay = d;
        renderToday();
        OrbitReminders.syncRemindersToSW();
      }
    };
    document.addEventListener('visibilitychange', async () => {
      if (!document.hidden) {
        checkDay();
        // Re-lock on return if PIN enabled? Keep session unlocked for usability.
      }
    });
    setInterval(checkDay, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
