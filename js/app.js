import { levelOf, levelInfo, rankOf, stats, dkey, agoKey, xpFor } from './rpg.js';
import { createStore, parseBackup } from './store.js';
import * as TM from './timer.js';
import { createAudio } from './audio.js';
import { createWolf, wolfSVG } from './wolf.js';

const APP_VERSION = '4.0.0';
const APP_NAME = 'Zyntry';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- storage (falls back to memory if the browser blocks it) ---------- */
let volatile = false;
const storage = (() => {
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return localStorage; }
  catch (e) {
    volatile = true; const m = new Map();
    return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  }
})();
const store = createStore(storage);
const settings = () => store.settings;
let timer = store.timer;
const setTimer = t => { timer = t; store.saveTimer(t); };
const audio = createAudio(settings);
const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

/* ---------- small UI helpers ---------- */
let toastT;
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
let dlgResolve = null, dlgButtons = [];
function dialog({ title, text = '', body = '', buttons = [{ label: 'OK', value: true, primary: true }] }) {
  return new Promise(res => {
    if (dlgResolve) closeDlg(null);
    dlgResolve = res; dlgButtons = buttons;
    $('dlgBox').innerHTML = `<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${body}<div class="dlgbtns">${buttons.map((b, i) => `<button class="btn-sm ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    $('dlg').classList.add('open');
    const f = $('dlgBox').querySelector('input[type=text]'); if (f) setTimeout(() => f.focus(), 60);
  });
}
function closeDlg(v) { $('dlg').classList.remove('open'); const r = dlgResolve; dlgResolve = null; if (r) r(v); }
$('dlg').addEventListener('click', e => {
  if (e.target === $('dlg')) return closeDlg(null);
  const r = e.target.closest('[data-resolve]'); if (r) return closeDlg(r.dataset.resolve);
  const b = e.target.closest('button[data-i]'); if (b) closeDlg(dlgButtons[+b.dataset.i].value);
});
document.addEventListener('keydown', e => {
  if ($('dlg').classList.contains('open')) {
    if (e.key === 'Escape') closeDlg(null);
    else if (e.key === 'Enter' && e.target.matches('input[type=text]')) { e.preventDefault(); const p = dlgButtons.find(b => b.primary); if (p) closeDlg(p.value); }
    return;
  }
  if (e.code === 'Space' && e.target === document.body && view === 'timerView') { e.preventDefault(); toggle(); }
});

const fmtClock = ms => { const s = Math.ceil(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const fmtMin = sec => { const m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + 'm'; };
const R = 48, C = 2 * Math.PI * R;
const NAMES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6a.6.6 0 0 0 .92.5l10.6-6.8a.6.6 0 0 0 0-1L8.92 4.7A.6.6 0 0 0 8 5.2z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/* ---------- theme ---------- */
function applyTheme() {
  const s = settings(), b = document.body;
  b.dataset.accent = s.accent; b.dataset.black = s.black ? '1' : '0'; b.dataset.calm = s.calm ? '1' : '0'; b.dataset.wolf = s.wolf ? '1' : '0';
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = s.black ? '#000000' : '#06070c';
}

/* ---------- timer view ---------- */
const progress = $('progress'), endcap = $('endcap');
progress.style.strokeDasharray = C;
(function ticks() {
  let s = '';
  for (let i = 0; i < 60; i++) {
    const a = i * Math.PI / 30, big = i % 5 === 0, r1 = big ? 55 : 56.4, r2 = 58.6;
    s += `<line class="tick ${big ? 'big' : ''}" x1="${60 + r1 * Math.sin(a)}" y1="${60 - r1 * Math.cos(a)}" x2="${60 + r2 * Math.sin(a)}" y2="${60 - r2 * Math.cos(a)}"/>`;
  }
  $('ticks').innerHTML = s;
})();

let lastClock = '';
function renderClock() {
  const ms = TM.remaining(timer, Date.now()), txt = fmtClock(ms);
  if (txt !== lastClock) { lastClock = txt; $('clock').textContent = txt; document.title = timer.running ? txt + ' · ' + APP_NAME : APP_NAME; }
  const frac = Math.min(1, Math.max(0, ms / timer.total));
  progress.style.strokeDashoffset = C * (1 - frac);
  const th = frac * 2 * Math.PI;
  endcap.setAttribute('cx', 60 + R * Math.cos(th)); endcap.setAttribute('cy', 60 + R * Math.sin(th));
  endcap.style.display = frac > 0 ? '' : 'none';
}
function renderTimer() {
  const now = Date.now(), ms = TM.remaining(timer, now);
  $('label').innerHTML = (timer.running ? '<span class="live"></span>' : '') + NAMES[timer.mode];
  $('toggleText').textContent = timer.running ? 'Pause' : (ms < timer.total ? 'Resume' : 'Start');
  $('toggleIcon').innerHTML = timer.running ? ICON_PAUSE : ICON_PLAY;
  document.body.dataset.mode = timer.mode;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === timer.mode));
  const dots = $('dots'); dots.innerHTML = '';
  for (let i = 0; i < settings().rounds; i++) { const d = document.createElement('span'); d.className = 'dot' + (i < timer.completed ? ' done' : ''); dots.appendChild(d); }
  $('taskName').textContent = (timer.task && store.taskTitle(timer.task)) || 'None';
  const li = levelInfo(store.totalXp());
  const tier = { E: 0, D: 1, C: 1, B: 2, A: 2, S: 3 }[li.rank];
  wolf.tier(tier); $('lvlWolf').dataset.tier = String(tier);
  wolf.set(timer.running ? (timer.mode === 'focus' ? 'focus' : 'rest') : TM.inProgress(timer) ? 'paused' : 'idle', { talk: booted });
  const td = todayInfo();
  $('goalTxt').innerHTML = `<b>${td.n}</b> / ${settings().goal} today`; $('goalTxt').classList.toggle('met', td.n >= settings().goal);
  $('streakN').textContent = td.streak; $('streakChip').classList.toggle('hot', td.streak > 0);
  syncAmbient();
  $('lvNum').textContent = li.level; $('rankLetter').textContent = li.rank; $('rankName').textContent = 'Rank ' + li.rank;
  $('xpNum').textContent = li.into + ' / ' + li.need + ' XP'; $('xpBar').style.width = (li.into / li.need * 100) + '%';
  lastClock = ''; renderClock();
}

/* ---------- wolf, goal, focus sounds ---------- */
const wolf = createWolf($('wolf'), $('bubble'));
$('lvlWolf').innerHTML = wolfSVG();
let booted = false;
function todayInfo() {
  const s = stats(store.history, store.tasks, Date.now());
  return { n: s.todayN, streak: s.streak };
}
$('wolf').onclick = () => { audio.unlock(); audio.play('tap'); buzz(15); wolf.react('happy', 1800, wolf.line('tap')); };
const AMB_NAMES = { off: 'Off', rain: 'Rain', brown: 'Brown noise', waves: 'Waves', white: 'White noise' };
const AMB_ORDER = ['off', 'rain', 'brown', 'waves', 'white'];
function syncAmbient() {
  const k = settings().ambient;
  $('soundName').textContent = AMB_NAMES[k]; $('soundChip').classList.toggle('on', k !== 'off');
  audio.ambient(timer.running && timer.mode === 'focus' ? k : 'off');
}
$('soundChip').onclick = () => {
  const k = AMB_ORDER[(AMB_ORDER.indexOf(settings().ambient) + 1) % AMB_ORDER.length];
  store.setSettings({ ambient: k }); syncAmbient(); audio.unlock(); audio.play('tap');
  toast(k === 'off' ? 'Focus sound off' : `Focus sound: ${AMB_NAMES[k]}` + (timer.running && timer.mode === 'focus' ? '' : ' · plays while you focus'));
};

/* ---------- wake lock ---------- */
let wake;
async function lockScreen() { try { if ('wakeLock' in navigator && timer.running) wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
function unlockScreen() { try { wake && wake.release(); } catch (e) {} wake = null; }

/* ---------- notifications ---------- */
function notify(title, body) {
  if (!settings().notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;      // in-app sound and toast cover the visible case
  try {
    const opts = { body, icon: 'icons/icon-192.png', tag: 'sl-session' };
    (navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : Promise.resolve(null))
      .then(r => r ? r.showNotification(title, opts) : new Notification(title, opts)).catch(() => {});
  } catch (e) {}
}

/* ---------- timer actions ---------- */
let countSec = null, warned = null, reloadPending = false;

function toggle() { timer.running ? pause() : start(); }
function start() {
  audio.unlock(); audio.play('start');
  setTimer(TM.start(timer, Date.now())); countSec = null;
  lockScreen(); renderTimer();
}
function pause() {
  audio.play('pause'); setTimer(TM.pause(timer, Date.now())); unlockScreen(); renderTimer();
}
const needsConfirm = () => timer.mode === 'focus' && TM.inProgress(timer) && TM.elapsed(timer, Date.now()) >= 10000;
async function confirmAbandon() {
  const sid = timer.sid;
  const ok = await dialog({
    title: 'Abandon this session?', text: 'It will not earn XP. Time already focused (if at least 1 minute) is recorded as interrupted.',
    buttons: [{ label: 'Keep going', value: false, cls: 'ghost', primary: true }, { label: 'Abandon', value: true, cls: 'danger' }]
  });
  return ok === true && timer.sid === sid;               // false if the session ended while the dialog was open
}
function abandonCurrent() { const e = TM.abandonedEntry(timer, Date.now()); if (e) store.addSession(e); }
function resetTo(mode) { setTimer(TM.newTimer(settings(), mode, timer.completed, timer.task)); unlockScreen(); countSec = null; renderAll(); }

async function doReset() {
  audio.unlock();
  if (needsConfirm() && !(await confirmAbandon())) return;
  abandonCurrent(); audio.play('reset'); resetTo(timer.mode);
}
async function doSkip() {
  audio.unlock();
  if (needsConfirm() && !(await confirmAbandon())) return;
  abandonCurrent(); audio.play('tap'); resetTo(timer.mode === 'focus' ? 'short' : 'focus');
}
async function switchMode(m) {
  if (m === timer.mode) return;
  if (needsConfirm() && !(await confirmAbandon())) return;
  abandonCurrent(); audio.play('tap'); resetTo(m);
}

function finish(n) {
  const t = timer, over = n - t.endAt, fresh = over < 5000;
  const entry = TM.completedEntry(t);
  let added = false, leveled = null;
  const goalBefore = todayInfo().n;
  if (entry) {
    const before = levelOf(store.totalXp());
    added = store.addSession(entry);                     // history is written BEFORE the timer state, and ids are unique:
    if (added) {                                         // a crash or a second tab can never double-count a session
      if (entry.k) store.bumpTask(entry.k);
      const after = levelOf(store.totalXp());
      if (after > before) leveled = [before, after];
    }
  }
  const nx = TM.nextAfterComplete(t, settings());
  let next = TM.newTimer(settings(), nx.mode, nx.completed, t.task);
  const auto = settings().auto && fresh;
  if (auto) next = TM.start(next, n);
  setTimer(next); countSec = null;
  if (!auto) unlockScreen();

  if (t.mode === 'focus') {
    if (fresh) { audio.play('focusDone'); buzz([200, 100, 200, 100, 300]); }
    const g = settings().goal, goalNow = todayInfo().n;
    if (added && goalBefore < g && goalNow >= g) { wolf.react('howl', 3600, wolf.line('goal')); setTimeout(() => toast(`Daily goal reached · ${goalNow}/${g} 🎯`, 3600), 3700); }
    else if (added) wolf.react('happy', 3200, wolf.line('done') + (entry.x ? ` +${entry.x} XP` : ''));
    if (added) toast(entry.x ? `Session complete · +${entry.x} XP` : 'Session complete · no XP (under 10 min)', 3600);
    notify('Focus session complete', entry && entry.x ? `+${entry.x} XP. Time for a break.` : 'Time for a break.');
  } else {
    if (fresh) { audio.play('breakDone'); buzz([200, 100, 200]); }
    toast('Break over — ready to focus', 3000); wolf.react('happy', 2200, 'Break’s over. Back on the hunt?');
    notify('Break is over', 'Ready for the next focus session?');
  }
  if (!fresh) toast('Your session finished while you were away', 4000);
  if (leveled) setTimeout(() => levelUp(leveled[0], leveled[1]), fresh ? 700 : 200);
  renderAll();
}

function levelUp(a, b) {
  $('lvlN').textContent = b;
  $('lvlS').textContent = rankOf(b) !== rankOf(a) ? 'Rank up · ' + rankOf(a) + ' → ' + rankOf(b) : 'Rank ' + rankOf(b);
  $('lvl').classList.add('show'); wolf.react('howl', 3200); audio.play('levelUp'); buzz([60, 40, 60, 40, 200]);
  clearTimeout(levelUp.t); levelUp.t = setTimeout(() => $('lvl').classList.remove('show'), 3200);
}
$('lvl').onclick = () => $('lvl').classList.remove('show');

function tick() {
  const n = Date.now();
  if (timer.running) {
    if (TM.expired(timer, n)) { finish(n); return; }
    const ms = TM.remaining(timer, n), s = Math.ceil(ms / 1000);
    if (settings().ticks && s <= 3 && s !== countSec && document.visibilityState === 'visible') { countSec = s; audio.play('count'); }
    if (timer.mode === 'focus' && timer.total > 180000 && s <= 60 && s >= 57 && warned !== timer.sid) {
      warned = timer.sid; toast('1 minute left'); notify('1 minute left', 'Finish strong.');
    }
    renderClock();
  } else if (reloadPending && !$('dlg').classList.contains('open')) { location.reload(); return; }
  if (view === 'statsView') renderStats();
}

$('toggle').onclick = toggle;
$('reset').onclick = doReset;
$('skip').onclick = doSkip;
$('tabs').onclick = e => { const b = e.target.closest('.tab'); if (b) switchMode(b.dataset.mode); };

/* ---------- navigation ---------- */
let view = 'timerView';
function go(v) {
  view = v;
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x.id === v));
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x.dataset.view === v));
  if (v === 'tasksView') renderTasks(); if (v === 'statsView') { lastStats = ''; renderStats(); } if (v === 'settingsView') renderSettings();
}
$('nav').onclick = e => { const b = e.target.closest('button'); if (!b || b.dataset.view === view) return; audio.unlock(); audio.play('tap'); go(b.dataset.view); };

/* ---------- tasks ---------- */
let filter = 'today';
const PRI = { 1: 'High', 2: 'Medium', 3: 'Low' };
function taskList() {
  const tk = dkey(Date.now());
  let l = store.tasks.slice();
  if (filter === 'today') l = l.filter(t => t.day === tk || (!t.done && t.day < tk) || (t.done && dkey(t.doneAt) === tk));
  else if (filter === 'open') l = l.filter(t => !t.done);
  else l = l.filter(t => t.done).sort((a, b) => b.doneAt - a.doneAt).slice(0, 100);
  if (filter !== 'done') l.sort((a, b) => a.done - b.done || a.pri - b.pri || a.created - b.created);
  return l;
}
function renderTasks() {
  document.querySelectorAll('#taskFilter button').forEach(b => b.classList.toggle('active', b.dataset.f === filter));
  const l = taskList(), tk = dkey(Date.now());
  const empty = { today: 'Nothing planned for today.\nAdd a task above, then pick it on the Timer screen.', open: 'No open tasks.', done: 'No completed tasks yet.' }[filter];
  $('taskList').innerHTML = l.length ? l.map(t => {
    const meta = [t.n ? `${t.n} focus session${t.n === 1 ? '' : 's'}` : '', !t.done && t.day < tk ? 'carried over' : '', PRI[t.pri] + ' priority'].filter(Boolean).join(' · ');
    const on = timer.task === t.id;
    return `<div class="glass task ${t.done ? 'done' : ''}" data-id="${esc(t.id)}">
      <button class="ck" data-act="toggle" aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}">${ICON_CHECK}</button>
      <button class="tt" data-act="edit">${esc(t.title)}<span class="meta">${esc(meta)}</span></button>
      <span class="pri p${t.pri}" aria-hidden="true"></span>
      ${t.done ? '' : `<button class="pick ${on ? 'on' : ''}" data-act="focus">${on ? 'Active' : 'Focus'}</button>`}
    </div>`;
  }).join('') : `<div class="empty">${esc(empty).replace(/\n/g, '<br>')}</div>`;
}
$('taskForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('taskInput').value.trim(); if (!v) return;
  store.addTask(v, +$('taskPri').value); $('taskInput').value = ''; audio.play('tap'); renderTasks();
});
$('taskFilter').onclick = e => { const b = e.target.closest('button'); if (b) { filter = b.dataset.f; renderTasks(); } };
$('taskList').onclick = async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.closest('.task').dataset.id, t = store.tasks.find(x => x.id === id); if (!t) return;
  const act = b.dataset.act;
  if (act === 'toggle') {
    store.setTaskDone(id, !t.done);
    if (!t.done) { audio.unlock(); audio.play('task'); if (timer.task === id) setTimer({ ...timer, task: null }); }
    renderTasks(); renderTimer();
  } else if (act === 'focus') {
    setTimer({ ...timer, task: timer.task === id ? null : id }); toast(timer.task ? 'Focusing on: ' + t.title : 'Task cleared'); renderTasks(); renderTimer();
  } else if (act === 'edit') {
    const r = await dialog({
      title: 'Edit task',
      body: `<input type="text" id="edTitle" maxlength="120" value="${esc(t.title)}" aria-label="Task title"><select id="edPri" class="opt" style="width:100%">${[1, 2, 3].map(p => `<option value="${p}" ${p === t.pri ? 'selected' : ''}>${PRI[p]} priority</option>`).join('')}</select>`,
      buttons: [{ label: 'Delete', value: 'del', cls: 'danger' }, { label: 'Cancel', value: null, cls: 'ghost' }, { label: 'Save', value: 'save', primary: true }]
    });
    if (r === 'save') { const title = $('edTitle').value.trim(); if (title) store.updateTask(id, { title, pri: +$('edPri').value }); }
    else if (r === 'del') {
      const ok = await dialog({ title: 'Delete task?', text: `"${t.title}" will be removed. Your recorded sessions are kept.`, buttons: [{ label: 'Cancel', value: false, cls: 'ghost', primary: true }, { label: 'Delete', value: true, cls: 'danger' }] });
      if (ok === true) { store.deleteTask(id); if (timer.task === id) setTimer({ ...timer, task: null }); }
    }
    renderTasks(); renderTimer();
  }
};
$('taskChip').onclick = async () => {
  const open = store.tasks.filter(t => !t.done).sort((a, b) => a.pri - b.pri || a.created - b.created);
  const body = `<button class="opt ${!timer.task ? 'on' : ''}" data-resolve="">No task</button>` +
    open.map(t => `<button class="opt ${timer.task === t.id ? 'on' : ''}" data-resolve="${esc(t.id)}"><span class="pri p${t.pri}"></span>${esc(t.title)}</button>`).join('');
  const add = `<input type="text" id="quickTask" maxlength="120" placeholder="New task — type and press Add" aria-label="New task">`;
  const v = await dialog({ title: 'Focus on…', body: add + body, buttons: [{ label: 'Close', value: null, cls: 'ghost' }, { label: 'Add & focus', value: '__new', primary: true }] });
  if (v === null) return;
  if (v === '__new') {
    const title = ($('quickTask').value || '').trim(); if (!title) return;
    const t = store.addTask(title, 2); if (!t) return;
    setTimer({ ...timer, task: t.id }); toast('Focusing on: ' + t.title); renderTimer(); return;
  }
  setTimer({ ...timer, task: v || null }); renderTimer();
};

/* ---------- statistics + history ---------- */
let lastStats = '', histShown = 20, sortedRev = -1, sortedHist = [];
function liveSec() { return timer.mode === 'focus' && TM.inProgress(timer) ? TM.elapsed(timer, Date.now()) / 1000 : 0; }
function goalDays() {
  const g = settings().goal, per = new Map();
  for (const h of store.history) if (h.m === 'focus' && h.c) { const k = dkey(h.t); per.set(k, (per.get(k) || 0) + 1); }
  let n = 0; for (let i = 0; i < 7; i++) if ((per.get(agoKey(i)) || 0) >= g) n++;
  return n;
}
function renderStats() {
  const live = liveSec(), s = stats(store.history, store.tasks, Date.now(), live), li = levelInfo(store.totalXp());
  const max = Math.max(1, ...s.week.map(d => d.sec));
  const lvl = d => { const m = d.sec / 60; return m <= 0 ? '' : m < 15 ? 'l1' : m < 45 ? 'l2' : m < 90 ? 'l3' : 'l4'; };
  const card = (k, v, u) => `<div class="glass card"><div class="k">${k}</div><div class="v">${v}${u ? `<small>${u}</small>` : ''}</div></div>`;
  if (sortedRev !== store.rev) { sortedRev = store.rev; sortedHist = store.history.filter(h => h.m === 'focus').sort((a, b) => b.t - a.t); }
  const tk = dkey(Date.now()), yk = agoKey(1);
  let hist = '', lastDay = '';
  for (const h of sortedHist.slice(0, histShown)) {
    const k = dkey(h.t);
    if (k !== lastDay) { lastDay = k; hist += `<div class="hday">${k === tk ? 'Today' : k === yk ? 'Yesterday' : new Date(h.t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>`; }
    const title = h.k && store.taskTitle(h.k);
    hist += `<div class="hrow"><span class="dur">${Math.max(1, Math.round(h.s / 60))}m</span><span class="info">${new Date(h.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${title ? ' · ' + esc(title) : ''}</span>` +
      (h.c ? (h.x ? `<span class="badge ok">+${h.x} XP</span>` : '<span class="badge zero">No XP</span>') : '<span class="badge cut">Interrupted</span>') + '</div>';
  }
  const html = `
    <div class="glass hero">
      <div><div class="k">${live ? '<span class="live"></span>' : ''}Today</div><div class="big">${fmtMin(s.todaySec)}</div></div>
      <div style="text-align:center"><div class="k">XP today</div><div class="big">${s.todayXp}</div></div>
      <div style="text-align:right"><div class="k">Sessions</div><div class="big">${s.todayN}</div></div>
    </div>
    <div class="grid">
      ${card('This week', fmtMin(s.weekSec))}${card('This month', fmtMin(s.monthSec))}
      ${card('Daily average', fmtMin(s.avg7), '7 days')}${card('Best day', fmtMin(s.bestDay))}
      ${card('Day streak', s.streak, s.streak === 1 ? 'day' : 'days')}${card('Best streak', s.best, s.best === 1 ? 'day' : 'days')}
      ${card('Sessions done', s.done)}${card('Completion', s.rate == null ? '–' : s.rate, s.rate == null ? '' : '%')}
      ${card('Total focus', fmtMin(s.totalSec))}${card('Total XP', s.totalXp.toLocaleString())}
      ${card('Daily goal', s.todayN + ' / ' + settings().goal, 'sessions')}${card('Goal days', goalDays(s), 'last 7')}
      ${card('Level', li.level, 'Rank ' + li.rank)}${card('Tasks done', s.tasksDoneToday, 'today · ' + s.tasksDoneTotal + ' total')}
    </div>
    <div class="glass chart"><div class="k">Last 7 days</div>
      <div class="bars">${s.week.map((d, i) => `<div class="col ${i === 6 ? 'today' : ''} ${d.sec > 0 ? 'has' : ''}"><b>${d.sec > 0 ? fmtMin(d.sec) : ''}</b><i style="height:${Math.max(3, Math.round(d.sec / max * 100))}%"></i><span>${'SMTWTFS'[d.dow]}</span></div>`).join('')}</div></div>
    <div class="glass chart"><div class="k">Last 28 days</div>
      <div class="heat">${s.heat.map((d, i) => `<i class="${lvl(d)} ${i === 27 ? 'now' : ''}" title="${d.k}: ${fmtMin(d.sec)}"></i>`).join('')}</div></div>
    <div class="section-t">History</div>
    <div class="glass card hist" style="padding:0 6px 8px">${hist || '<div class="empty">No sessions recorded yet.<br>Finish a focus session and it will appear here.</div>'}</div>
    ${sortedHist.length > histShown ? '<button class="btn-sm ghost" id="moreHist" style="align-self:center">Show more</button>' : ''}
    <p class="fine">Focus time counts every minute actually focused, including interrupted sessions of at least 1 minute. XP, completion rate and streaks follow the rules in Settings.</p>`;
  if (html !== lastStats) {
    lastStats = html;
    const el = $('statsView'), top = el.scrollTop;
    el.innerHTML = html; el.scrollTop = top;
  }
}
$('statsView').onclick = e => { if (e.target.id === 'moreHist') { histShown += 30; lastStats = ''; renderStats(); } };

/* ---------- settings ---------- */
const NUM = { focus: 's-focus', short: 's-short', long: 's-long', rounds: 's-rounds', goal: 's-goal' }, BOOLS = { auto: 's-auto', sound: 's-sound', ticks: 's-ticks', notify: 's-notify', black: 's-black', calm: 's-calm', wolf: 's-wolf' };
function notifyNote() {
  if (!('Notification' in window)) return 'Not supported in this browser.';
  const p = Notification.permission;
  return (p === 'denied' ? 'Blocked in your browser settings. ' : '') + 'Only shown while the app is running — web apps cannot wake a locked iPhone.';
}
function renderSettings() {
  const s = settings();
  for (const k in NUM) $(NUM[k]).value = s[k];
  for (const k in BOOLS) $(BOOLS[k]).checked = s[k];
  $('s-volume').value = s.volume; $('s-ambient').value = s.ambient; $('s-ambVol').value = s.ambVol;
  document.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.dataset.a === s.accent));
  $('notifyNote').textContent = notifyNote();
  $('dataNote').textContent = `${store.history.length} sessions · ${store.tasks.length} tasks · saved on this device` + (volatile ? ' — WARNING: storage is blocked, data will be lost when you close the app' : '');
  $('ver').textContent = 'v' + APP_VERSION;
  offlineStatus();
}
function applySettings(patch) {
  const s = store.setSettings(patch);
  applyTheme();
  if (!TM.inProgress(timer)) { if (timer.total !== s[timer.mode] * 60000 || timer.completed >= s.rounds) resetTo(timer.mode === undefined ? 'focus' : timer.mode); }
  else if ('focus' in patch || 'short' in patch || 'long' in patch) toast('New durations apply to your next session');
  if (timer.completed >= s.rounds) setTimer({ ...timer, completed: 0 });
  renderSettings(); renderTimer(); renderChip();
}
for (const k in NUM) $(NUM[k]).addEventListener('change', e => { const v = parseInt(e.target.value, 10); applySettings(Number.isFinite(v) ? { [k]: v } : {}); });
for (const k in BOOLS) if (k !== 'notify') $(BOOLS[k]).addEventListener('change', e => { applySettings({ [k]: e.target.checked }); if (k === 'sound' && e.target.checked) { audio.unlock(); audio.play('tap'); } });
$('s-notify').addEventListener('change', async e => {
  if (e.target.checked) {
    let p = 'denied';
    try { if ('Notification' in window) p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission; } catch (_) {}
    if (p !== 'granted') { e.target.checked = false; toast('Notifications are not allowed for this app'); applySettings({ notify: false }); return; }
    applySettings({ notify: true }); toast('Notifications on');
  } else applySettings({ notify: false });
});
let vt; $('s-volume').addEventListener('input', e => { store.setSettings({ volume: +e.target.value }); clearTimeout(vt); vt = setTimeout(() => { audio.unlock(); audio.play('tap'); }, 90); });
$('s-ambient').addEventListener('change', e => { audio.unlock(); applySettings({ ambient: e.target.value }); });
$('s-ambVol').addEventListener('input', e => { store.setSettings({ ambVol: +e.target.value }); syncAmbient(); });
$('swatches').onclick = e => { const b = e.target.closest('.sw'); if (b) applySettings({ accent: b.dataset.a }); };

/* ---------- backup / restore / reset ---------- */
$('exportBtn').onclick = async () => {
  const data = JSON.stringify(store.exportData(), null, 1), name = `zyntry-backup-${dkey(Date.now())}.json`;
  try {
    const file = new File([data], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); toast('Backup shared'); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000); toast('Backup downloaded');
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const fail = text => dialog({ title: 'Cannot import', text, buttons: [{ label: 'OK', value: true, primary: true }] });
  if (f.size > 25e6) return fail('That file is too large to be a Zyntry backup.');
  let parsed;
  try { parsed = parseBackup(JSON.parse(await f.text())); }
  catch (err) { return fail(err instanceof SyntaxError ? 'The file is not valid JSON.' : err.message || 'The file could not be read.'); }
  const known = new Set(store.history.map(h => h.id)), tids = new Set(store.tasks.map(t => t.id));
  const newS = parsed.sessions.filter(s => !known.has(s.id)).length, newT = parsed.tasks.filter(t => !tids.has(t.id)).length;
  const r = await dialog({
    title: 'Import backup',
    text: `The file has ${parsed.sessions.length} sessions and ${parsed.tasks.length} tasks${parsed.rejected ? ` (${parsed.rejected} invalid entries will be skipped)` : ''}.\n\nMerge: adds ${newS} new sessions and ${newT} new tasks, keeps everything you have.\nReplace: swaps your data for the backup (a safety copy of your current data is kept on this device).`,
    buttons: [{ label: 'Cancel', value: null, cls: 'ghost' }, { label: 'Replace', value: 'replace', cls: 'danger' }, { label: 'Merge', value: 'merge', primary: true }]
  });
  if (!r) return;
  const res = store.importData(parsed, r);
  if (timer.task && !store.tasks.some(t => t.id === timer.task)) setTimer({ ...timer, task: null });
  applyTheme(); renderAll(); toast(r === 'merge' ? `Merged ${res.sessions} sessions, ${res.tasks} tasks` : `Restored ${res.sessions} sessions, ${res.tasks} tasks`);
};
$('wipeBtn').onclick = async () => {
  const r = await dialog({
    title: 'Reset all data?', text: `This permanently erases ${store.history.length} sessions, ${store.tasks.length} tasks, your XP, level and settings on this device.\n\nExport a backup first if you may want it back.`,
    buttons: [{ label: 'Cancel', value: false, cls: 'ghost', primary: true }, { label: 'Erase everything', value: true, cls: 'danger' }]
  });
  if (r !== true) return;
  store.resetAll(); unlockScreen(); timer = store.timer; store.saveTimer(timer); histShown = 20; applyTheme(); renderAll(); toast('All data erased');
};

/* ---------- offline / update / install ---------- */
async function offlineStatus() {
  let txt = 'Not ready yet — open the app once while online.';
  try { if ('serviceWorker' in navigator && navigator.serviceWorker.controller && (await caches.keys()).some(k => k.startsWith('zyntry-'))) txt = 'Ready — works without internet.'; } catch (e) {}
  $('offNote').textContent = txt;
}
function renderChip() {
  const c = $('chip');
  const msg = volatile || store.writeFailed ? 'Storage issue' : !navigator.onLine ? 'Offline' : '';
  c.textContent = msg; c.classList.toggle('show', !!msg); c.classList.toggle('warn', !!msg);
}
addEventListener('online', renderChip); addEventListener('offline', renderChip);
let installEvt;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('installRow').hidden = false; });
$('installBtn').onclick = async () => { if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('installRow').hidden = true; } };

let swReg = null;
$('updBtn').onclick = async () => {
  if (!swReg) return toast('Updates are checked automatically when online');
  try { await swReg.update(); toast(navigator.onLine ? 'Checked — you have the latest version' : 'You are offline'); } catch (e) { toast('Could not check right now'); }
};
if ('serviceWorker' in navigator) {
  let had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had) { had = true; offlineStatus(); return; }
    try { sessionStorage.setItem('sl.updated', '1'); } catch (e) {}
    reloadPending = true;                                  // reload as soon as no timer is running; saved data is untouched
    if (!timer.running && !$('dlg').classList.contains('open')) location.reload();
  });
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      swReg = reg; const check = () => reg.update().catch(() => {});
      setInterval(check, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    }).catch(() => {});
  });
}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
// another tab/window changed the data: reload to stay consistent
addEventListener('storage', e => { if (e.key && e.key.startsWith('sl.') && !e.key.endsWith('.corrupt') && !$('dlg').classList.contains('open')) location.reload(); });

/* ---------- boot ---------- */
function renderAll() { renderTimer(); renderChip(); if (view === 'tasksView') renderTasks(); if (view === 'statsView') { lastStats = ''; renderStats(); } if (view === 'settingsView') renderSettings(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); renderTimer(); lockScreen(); } });

applyTheme();
if (settings().notify && (!('Notification' in window) || Notification.permission !== 'granted')) store.setSettings({ notify: false });
if (timer.completed >= settings().rounds) timer = { ...timer, completed: 0 };
renderAll();
booted = true;
setTimeout(() => wolf.say(timer.running ? wolf.line(timer.mode === 'focus' ? 'focus' : 'rest') : (new Date().getHours() < 12 ? 'Good morning! ' : new Date().getHours() < 18 ? 'Hey there! ' : 'Evening hunt? ') + wolf.line('idle')), 700);
setInterval(tick, 250);
if (timer.running) { lockScreen(); tick(); }
if (store.warnings.length) setTimeout(() => toast('Some saved data could not be read. A copy was kept on this device.', 5000), 600);
try { if (sessionStorage.getItem('sl.updated')) { sessionStorage.removeItem('sl.updated'); setTimeout(() => toast('Updated to v' + APP_VERSION + ' — your data is safe'), 600); } } catch (e) {}
