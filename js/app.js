/**
 * Orbit UI — Today, Progress, Settings
 */
(function () {
  'use strict';

  const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  const TRASH_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

  let captureType = 'task';
  let toastTimer = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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

  function switchView(name) {
    $$('.view').forEach((v) => {
      const active = v.id === 'view-' + name;
      v.classList.toggle('view-active', active);
      v.hidden = !active;
    });
    $$('.nav-btn').forEach((btn) => {
      const on = btn.dataset.view === name;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (name === 'progress') renderProgress();
  }

  async function renderToday() {
    const today = OrbitDB.today();
    $('#today-date').textContent = formatHeaderDate();

    const habits = await OrbitDB.getHabits();
    const tasks = await OrbitDB.getTasksForDate(today);
    const completions = await OrbitDB.getCompletionsForDate(today);
    const doneSet = new Set(completions.map((c) => c.habitId));

    const habitsList = $('#habits-list');
    const habitsEmpty = $('#habits-empty');
    habitsList.innerHTML = '';

    if (habits.length === 0) {
      habitsEmpty.classList.remove('hidden');
    } else {
      habitsEmpty.classList.add('hidden');
      habits.forEach((h) => {
        const done = doneSet.has(h.id);
        habitsList.appendChild(makeHabitCard(h, done));
      });
    }

    const tasksList = $('#tasks-list');
    const tasksEmpty = $('#tasks-empty');
    tasksList.innerHTML = '';

    if (tasks.length === 0) {
      tasksEmpty.classList.remove('hidden');
    } else {
      tasksEmpty.classList.add('hidden');
      tasks.forEach((t) => {
        tasksList.appendChild(makeTaskCard(t, today));
      });
    }
  }

  function makeHabitCard(habit, done) {
    const li = document.createElement('li');
    li.className = 'item-card' + (done ? ' completed' : '');
    li.dataset.id = habit.id;
    li.innerHTML =
      '<div class="check" aria-hidden="true">' + CHECK_SVG + '</div>' +
      '<div class="item-body"><p class="item-title"></p><p class="item-meta">Habit · daily</p></div>' +
      '<button type="button" class="item-delete" aria-label="Delete habit">' + TRASH_SVG + '</button>';
    li.querySelector('.item-title').textContent = habit.name;

    li.addEventListener('click', async (e) => {
      if (e.target.closest('.item-delete')) return;
      await toggleHabit(habit.id, !done, li);
    });

    li.querySelector('.item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete habit "' + habit.name + '"?')) return;
      await OrbitDB.deleteHabit(habit.id);
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

  async function toggleHabit(id, done, el) {
    const today = OrbitDB.today();
    await OrbitDB.setHabitDone(id, today, done);
    if (done) {
      el.classList.add('completed', 'just-done');
      const result = await OrbitGame.awardXp(OrbitGame.XP_HABIT, today);
      showToast('+' + result.gained + ' XP' + (result.leveledUp ? ' · Level up!' : ''));
    } else {
      el.classList.remove('completed', 'just-done');
      await OrbitGame.revokeXp(OrbitGame.XP_HABIT);
      showToast('Undone');
    }
    await renderToday();
  }

  async function toggleTask(id, done, el) {
    const today = OrbitDB.today();
    await OrbitDB.setTaskCompleted(id, done);
    if (done) {
      el.classList.add('completed', 'just-done');
      const result = await OrbitGame.awardXp(OrbitGame.XP_TASK, today);
      showToast('+' + result.gained + ' XP' + (result.leveledUp ? ' · Level up!' : ''));
    } else {
      el.classList.remove('completed', 'just-done');
      await OrbitGame.revokeXp(OrbitGame.XP_TASK);
      showToast('Undone');
    }
    await renderToday();
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
      cell.className = 'week-dot' + (d.active ? ' active' : '') + (d.isToday ? ' today' : '');
      cell.innerHTML = '<div class="dot"></div><span class="dow"></span>';
      cell.querySelector('.dow').textContent = d.label;
      cell.title = d.date + (d.active ? ' · active' : '');
      weekEl.appendChild(cell);
    });
  }

  async function onCapture(e) {
    e.preventDefault();
    const input = $('#capture-input');
    const text = (input.value || '').trim();
    if (!text) return;

    if (captureType === 'habit') {
      await OrbitDB.addHabit(text);
      showToast('Habit added');
    } else {
      await OrbitDB.addTask(text, OrbitDB.today());
      showToast('Task added');
    }
    input.value = '';
    input.blur();
    await renderToday();
  }

  function bindCaptureType() {
    $$('.type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        captureType = btn.dataset.type;
        $$('.type-btn').forEach((b) => b.classList.toggle('active', b === btn));
        $('#capture-input').placeholder =
          captureType === 'habit' ? 'New daily habit…' : 'Add a task…';
      });
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
      const stamp = OrbitDB.today();
      a.href = url;
      a.download = 'orbit-backup-' + stamp + '.json';
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
        showToast('Imported');
      } catch (err) {
        console.error(err);
        alert('Could not import that file. Need a valid Orbit JSON backup.');
      }
    });

    $('#btn-reset').addEventListener('click', async () => {
      if (!confirm('Reset ALL Orbit data on this device? This cannot be undone.')) return;
      await OrbitDB.resetAll();
      await renderToday();
      await renderProgress();
      showToast('Reset complete');
    });
  }

  async function boot() {
    await OrbitDB.init();
    bindCaptureType();
    bindNav();
    bindBackup();
    $('#capture-form').addEventListener('submit', onCapture);
    await renderToday();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
