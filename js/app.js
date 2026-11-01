import { levelOf, levelInfo, rankOf, rankInfo, RANKS, stats, dkey, agoKey, xpFor, discipline, STAGES, STRONG_DAY, dayparts, DAYPARTS } from './rpg.js';
import { createStore, parseBackup } from './store.js';
import * as TM from './timer.js';
import { createAudio } from './audio.js';
import { createWolf, wolfSVG } from './wolf.js';
import { createVoice, createListener } from './voice.js';
import { createZynVoice } from './zynvoice.js';
import { createAssistant } from './ai/assistant.js';
import { rulesEngine, createWebLLMEngine, createServerEngine, WEBLLM_MODELS, isPrivateUrl } from './ai/engines.js';
import { initChat } from './ui/chat.js';
import { initTrack, activityStatsHTML } from './ui/track.js';
import { fmtQty, labelOf } from './catalog.js';
import { goalProgress } from './analytics.js';
import { BACKGROUNDS } from './store.js';

const APP_VERSION = '7.0.0';
const APP_NAME = 'ZENTRY';
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
const zynVoice = createZynVoice({ context: () => audio.context(), output: () => audio.voiceOut() });
const voice = createVoice(settings, zynVoice, audio);
const listener = createListener();

/* ---------- small UI helpers ---------- */
let toastT;
function toast(msg, ms = 2600, act = null) {
  const t = $('toast'); t.textContent = msg;
  if (act) { const b = document.createElement('button'); b.type = 'button'; b.textContent = act.label; b.onclick = () => { t.classList.remove('show'); act.fn(); }; t.appendChild(b); }
  t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
let dlgResolve = null, dlgButtons = [];
function dialog({ title, text = '', body = '', buttons = [{ label: 'OK', value: true, primary: true }], onOpen = null }) {
  return new Promise(res => {
    if (dlgResolve) closeDlg(null);
    dlgResolve = res; dlgButtons = buttons;
    $('dlgBox').innerHTML = `<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${body}<div class="dlgbtns">${buttons.map((b, i) => `<button class="btn-sm ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    $('dlg').classList.add('open');
    if (onOpen) onOpen();
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
    else if (e.key === 'Enter' && e.target.matches('#dlgBox input')) { e.preventDefault(); const p = dlgButtons.find(b => b.primary); if (p) closeDlg(p.value); }
    return;
  }
  if (e.target !== document.body || e.metaKey || e.ctrlKey || e.altKey) return;
  if (view !== 'timerView') return;
  // desktop shortcuts: Space start/pause · R reset · S skip · F focus mode · 1 2 3 modes · + add 5 min
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.key === 'r' || e.key === 'R') doReset();
  else if (e.key === 's' || e.key === 'S') doSkip();
  else if (e.key === 'f' || e.key === 'F') setZen(document.body.dataset.zen !== '1');
  else if (e.key === 'Escape' && document.body.dataset.zen === '1') setZen(false);
  else if (e.key === '1' || e.key === '2' || e.key === '3') switchMode(['focus', 'short', 'long'][+e.key - 1]);
  else if (e.key === '+' || e.key === '=') extend();
});

const fmtClock = ms => { const s = Math.ceil(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const fmtMin = sec => { const m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + 'm'; };
const R = 53, C = 2 * Math.PI * R;
const NAMES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6a.6.6 0 0 0 .92.5l10.6-6.8a.6.6 0 0 0 0-1L8.92 4.7A.6.6 0 0 0 8 5.2z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/* ---------- theme ---------- */
const BG_COLOR = { den: '#15123a', aurora: '#07080f', amoled: '#000000', charcoal: '#131417', midnight: '#0d1838', purple: '#150a27', gradient: '#111b3c', wolf: '#0c1232', mountains: '#141a3a', forest: '#06201b', light: '#f3f4f8' };
const BG_NAMES = { den: 'Night den', aurora: 'Aurora', amoled: 'AMOLED', charcoal: 'Charcoal', midnight: 'Midnight', purple: 'Purple', gradient: 'Dusk', wolf: 'Wolf moon', mountains: 'Mountains', forest: 'Forest', light: 'Light' };
function applyTheme() {
  const s = settings(), b = document.body;
  b.dataset.accent = s.accent; b.dataset.calm = s.calm ? '1' : '0'; b.dataset.wolf = s.wolf ? '1' : '0';
  b.dataset.bg = s.bg; b.dataset.theme = s.bg === 'light' ? 'light' : 'dark'; $('backdrop').dataset.bg = s.bg;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = BG_COLOR[s.bg] || '#15123a';
}

/* ---------- timer view ---------- */
const progress = $('progress'), endcap = $('endcap');
progress.style.strokeDasharray = C;
(function ticks() {
  let s = '';
  for (let i = 0; i < 60; i += 5) {
    const a = i * Math.PI / 30, big = i % 15 === 0, r1 = big ? 41.5 : 42.6, r2 = 44;
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
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function renderRunline() {
  const on = TM.inProgress(timer);
  $('runline').classList.toggle('on', on);
  $('endsAt').textContent = timer.running ? `Ends at ${fmtTime(timer.endAt)}` : on ? 'Paused' : `${Math.round(timer.total / 60000)} min · tap the time to change`;
  $('extend').hidden = !on || timer.total >= 180 * 60000;
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
  const tk = timer.task && store.tasks.find(x => x.id === timer.task);
  $('taskName').textContent = tk ? tk.title : 'Pick a task'; $('taskChip').classList.toggle('on', !!tk);
  $('taskProg').textContent = tk && tk.est ? `${tk.n}/${tk.est}` : ''; $('taskProg').classList.toggle('over', !!(tk && tk.est && tk.n >= tk.est));
  const li = levelInfo(store.totalXp());
  const dz = discipline(store.history, Date.now());
  wolf.stage(dz.stage.n); wolf.mood(dz.vitality); $('lvlWolf').dataset.stage = String(dz.stage.n);
  $('player').dataset.rank = li.rank; $('rankName').textContent = 'Rank ' + li.rank + ' · ' + RANKS.find(r => r.r === li.rank).title;
  $('stageName').textContent = dz.stage.name;
  checkEvolution(dz);
  wolf.set(wolfBase(), { talk: booted, voice: settings().chatty });
  $('chatWolf').dataset.stage = String(dz.stage.n); $('chatWolf').dataset.mood = dz.vitality;
  const td = todayInfo();
  $('goalTxt').innerHTML = `<b>${td.n}</b> of ${settings().goal} today${td.sec >= 60 ? ` · ${fmtMin(td.sec)}` : ''}`; $('goalTxt').classList.toggle('met', td.n >= settings().goal);
  $('streakN').textContent = td.streak; $('streakChip').classList.toggle('hot', td.streak > 0);
  syncAmbient();
  $('lvNum').textContent = li.level; $('rankLetter').textContent = li.rank;
  $('xpNum').textContent = li.into + ' / ' + li.need + ' XP'; $('xpBar').style.width = (li.into / li.need * 100) + '%';
  lastClock = ''; renderClock(); renderRunline();
}

/* ---------- wolf, goal, focus sounds ---------- */
const wolf = createWolf($('wolf'), $('bubble'), voice);
$('lvlWolf').innerHTML = wolfSVG();
let booted = false;
// Zyn's mood follows what is actually happening (never random):
// focus (first half) → working (second half) · paused · rest (break running) · proud (today's goal met) · serious (yesterday's goal missed) · idle
function wolfBase() {
  if (timer.running) return timer.mode !== 'focus' ? 'rest' : TM.elapsed(timer, Date.now()) >= timer.total / 2 ? 'working' : 'focus';
  if (TM.inProgress(timer)) return 'paused';
  const g = settings().goal, today = dkey(Date.now()), yday = agoKey(1);
  let t = 0, y = 0, any = false;
  for (const h of store.history) if (h.m === 'focus' && h.c) { any = true; const k = dkey(h.t); if (k === today) t++; else if (k === yday) y++; }
  if (t >= g) return 'proud';
  if (any && y < g && t === 0) return 'serious';
  return 'idle';
}
let lastBase = '';
function todayInfo() {
  const s = stats(store.history, store.tasks, Date.now());
  return { n: s.todayN, streak: s.streak, sec: s.todaySec };
}
$('stageChip').onclick = () => { audio.unlock(); audio.play('tap'); go('statsView'); };
$('player').onclick = () => { audio.unlock(); audio.play('tap'); go('statsView'); };
$('wolf').onclick = () => { audio.unlock(); buzz(15); wolf.react('happy', 2200, wolf.line('tap'), { priority: true, force: settings().voice }); };
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
// Banner at the top of the screen. Shown whether the app is open or in the background
// (iOS: needs the app on the Home Screen, iOS 16.4+). One tag, so a newer banner replaces an older one.
function notify(title, body, force = false) {
  if ((!settings().notify && !force) || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'zentry', renotify: true, silent: false, vibrate: [200, 100, 200], data: { url: location.href } };
    (navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : Promise.resolve(null))
      .then(r => r ? r.showNotification(title, opts) : new Notification(title, opts)).catch(() => {});
  } catch (e) {}
}

/* ---------- alarm: the end sound repeats (3x) until you touch the screen ---------- */
let alarmT = [];
function stopAlarm() { alarmT.forEach(clearTimeout); alarmT = []; }
function alarm(name) {
  stopAlarm(); audio.play(name);
  if (settings().alarm) for (let i = 1; i < 3; i++) alarmT.push(setTimeout(() => audio.play(name), i * 3200));
}
addEventListener('pointerdown', stopAlarm, true);

/* ---------- timer actions ---------- */
let countSec = null, warned = null, reloadPending = false;

function toggle() { timer.running ? pause() : start(); }
function start() {
  audio.unlock(); audio.play('start');
  const fresh = !TM.inProgress(timer);
  setTimer(TM.start(timer, Date.now())); countSec = null;
  lockScreen(); renderTimer();
  if (fresh) {                                              // a fresh start always gets a spoken line, even when Zyn is not chatty
    const l = timer.mode === 'focus' ? wolf.line('focus') : timer.mode === 'long' ? ['Long break! You earned it.', 'happy', 'yipyip'] : wolf.line('rest');
    wolf.say(l, { priority: true });
  }
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
    if (fresh) { alarm('focusDone'); buzz([200, 100, 200, 100, 300]); }
    const g = settings().goal, goalNow = todayInfo().n;
    if (added && goalBefore < g && goalNow >= g) { wolf.react('howl', 3600, wolf.line('goal'), { priority: true, voice: fresh }); setTimeout(() => toast(`Daily goal reached · ${goalNow}/${g}`, 3600), 3700); }
    else if (added) { const [t1, m1, s1] = wolf.line('done'); wolf.react('happy', 3400, [`${t1} ${nx.mode === 'long' ? 'Long break time!' : 'Take a short break.'}`, m1, s1], { priority: true, voice: fresh }); }
    if (added) toast(entry.x ? `Session complete · +${entry.x} XP` : 'Session complete · no XP (under 10 min)', 3600);
    notify('🐺 Focus complete!', (entry && entry.x ? `+${entry.x} XP. ` : '') + (nx.mode === 'long' ? `Long break: ${settings().long} min. You earned it.` : `Take a ${settings().short}-min break.`) + (t.task && store.taskTitle(t.task) ? ` · ${store.taskTitle(t.task)}` : ''));
  } else {
    if (fresh) { alarm('breakDone'); buzz([200, 100, 200]); }
    toast('Break over — ready to focus', 3000); wolf.react('happy', 2600, ['Break’s over! Back on the hunt?', 'excited', 'yipyip'], { priority: true, voice: fresh });
    notify('⏰ Break is over', `Zyn is ready. Next: ${settings().focus}-min focus.`);
  }
  if (!fresh) toast('Your session finished while you were away', 4000);
  if (leveled) setTimeout(() => levelUp(leveled[0], leveled[1]), fresh ? 700 : 200);
  renderAll();
}

const celebrateQ = [];
function celebrate(c) {
  if ($('lvl').classList.contains('show')) { celebrateQ.push(c); return; }
  $('lvlT').textContent = c.kicker; $('lvlN').textContent = c.big; $('lvlS').textContent = c.sub;
  $('lvl').dataset.kind = c.kind; $('lvl').classList.add('show');
  wolf.react('howl', 3200); audio.play(c.sound); buzz([60, 40, 60, 40, 200]);
  setTimeout(() => voice.speak(c.kind === 'evolve' ? `Wow! I evolved! I'm a ${c.big} now!` : c.kind === 'rank' ? `Rank up! You're rank ${c.big} now!` : `Level up! Level ${c.big}!`, { mood: 'excited', sound: c.kind === 'level' ? 'yipyip' : 'awoo', priority: true }), 900);
  clearTimeout(celebrate.t); celebrate.t = setTimeout(closeCelebrate, c.ms || 3400);
}
function closeCelebrate() { $('lvl').classList.remove('show'); const n = celebrateQ.shift(); if (n) setTimeout(() => celebrate(n), 250); }
function levelUp(a, b) {
  const ra = rankOf(a), rb = rankOf(b);
  if (ra !== rb) {
    const t = RANKS.find(r => r.r === rb).title;
    celebrate({ kind: 'rank', kicker: 'RANK UP', big: rb, sub: `${t} · Level ${b}`, sound: 'rankUp', ms: 4200 });
  } else celebrate({ kind: 'level', kicker: 'LEVEL UP', big: String(b), sub: 'Rank ' + rb + ' · ' + RANKS.find(r => r.r === rb).title, sound: 'levelUp' });
}
// Zyn evolves when discipline points cross a stage. Stored so it is celebrated once.
function checkEvolution(dz) {
  let seen = 0; try { seen = +storage.getItem('sl.evo') || 0; } catch (e) {}
  if (seen === dz.stage.n) return;
  try { storage.setItem('sl.evo', String(dz.stage.n)); } catch (e) {}
  if (seen && dz.stage.n > seen) setTimeout(() => celebrate({ kind: 'evolve', kicker: 'ZYN EVOLVED', big: dz.stage.name, sub: dz.stage.note, sound: 'evolve', ms: 4600 }), 900);
}
$('lvl').onclick = () => { clearTimeout(celebrate.t); closeCelebrate(); };

function tick() {
  const n = Date.now();
  if (timer.running) {
    if (TM.expired(timer, n)) { finish(n); return; }
    const ms = TM.remaining(timer, n), s = Math.ceil(ms / 1000);
    if (settings().ticks && s <= 3 && s !== countSec && document.visibilityState === 'visible') { countSec = s; audio.play('count'); }
    if (timer.mode === 'focus' && timer.total > 180000 && s <= 60 && s >= 57 && warned !== timer.sid) {
      warned = timer.sid; toast('1 minute left'); audio.play('warn'); notify('⏳ 1 minute left', 'Finish strong.');
      wolf.say(['One minute left! Finish strong!', 'excited', 'yip'], { priority: true });
    }
    renderClock();
    const b = wolfBase(); if (b !== lastBase) { lastBase = b; wolf.set(b, { talk: true, voice: settings().chatty }); }
    if (timer.running && lastEnds !== timer.endAt) { lastEnds = timer.endAt; renderRunline(); }
  } else if (reloadPending && !$('dlg').classList.contains('open')) { location.reload(); return; }
  if (view === 'statsView') renderStats();
}

let lastEnds = 0;
$('toggle').onclick = toggle;
/* ---------- extra time, session length, focus mode ---------- */
function extend() {
  if (!TM.inProgress(timer) || timer.total >= 180 * 60000) return;
  audio.unlock(); audio.play('tap'); setTimer(TM.addTime(timer, 5 * 60000, Date.now())); renderTimer();
  toast(`+5 min · ${timer.running ? 'ends at ' + fmtTime(timer.endAt) : Math.ceil(TM.remaining(timer, Date.now()) / 60000) + ' min left'}`);
}
$('extend').onclick = extend;
const PRESETS = [
  { id: 'classic', name: 'Classic', focus: 25, short: 5, long: 15, note: 'The original Pomodoro' },
  { id: 'deep', name: 'Deep work', focus: 50, short: 10, long: 20, note: 'Long blocks for hard tasks' },
  { id: 'flow', name: 'Flow', focus: 90, short: 15, long: 30, note: 'One big block, one real rest' },
  { id: 'sprint', name: 'Sprint', focus: 15, short: 3, long: 10, note: 'Easy start on a low-energy day' }
];
const presetOf = s => PRESETS.find(p => p.focus === s.focus && p.short === s.short && p.long === s.long);
function presetButtons(cls = '') {
  const cur = presetOf(settings());
  return PRESETS.map(p => `<button type="button" class="preset ${cls} ${cur && cur.id === p.id ? 'on' : ''}" data-resolve="${p.id}" data-preset="${p.id}"><b>${p.focus}<small>/${p.short}</small></b><span>${p.name}</span><em>${p.note}</em></button>`).join('');
}
function applyPreset(id) {
  const p = PRESETS.find(x => x.id === id); if (!p) return;
  if (TM.inProgress(timer)) { toast('Finish or reset this session first'); return; }
  applySettings({ focus: p.focus, short: p.short, long: p.long }); audio.play('tap'); toast(`${p.name}: ${p.focus} min focus, ${p.short} min break`);
}
$('clockBtn').onclick = async () => {
  audio.unlock();
  if (TM.inProgress(timer)) { toast(timer.running ? 'Pause or reset to change the length · +5 min adds time' : 'Reset to change the length'); return; }
  const v = await dialog({ title: 'Session length', text: 'Pick a rhythm. You can fine-tune minutes in Settings.', body: `<div class="presets">${presetButtons()}</div>`, buttons: [{ label: 'Close', value: null, cls: 'ghost' }, { label: 'Custom…', value: '__custom' }] });
  if (v === '__custom') go('settingsView'); else if (v) applyPreset(v);
};
function setZen(on) {
  document.body.dataset.zen = on ? '1' : '0';
  try {
    if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (e) {}
}
$('zenBtn').onclick = () => { audio.unlock(); audio.play('tap'); setZen(true); };
$('zenExit').onclick = () => setZen(false);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.dataset.zen === '1') setZen(false); });
$('reset').onclick = doReset;
$('skip').onclick = doSkip;
$('tabs').onclick = e => { const b = e.target.closest('.tab'); if (b) switchMode(b.dataset.mode); };

/* ---------- navigation ---------- */
let view = 'timerView';
function go(v) {
  view = v;
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x.id === v));
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === v));
  if (v === 'tasksView') renderTasks(); if (v === 'statsView') { lastStats = ''; renderStats(); } if (v === 'settingsView') renderSettings();
  if (v === 'trackView') track.render(); if (v === 'chatView') { chat.render(); aiStatus(); setTimeout(() => matchMedia('(min-width: 720px)').matches && $('chatInput').focus(), 50); }
}
document.addEventListener('click', e => { const b = e.target.closest('nav button[data-view], #settingsBtn'); if (!b || b.dataset.view === view) return; audio.unlock(); audio.play('tap'); go(b.dataset.view); });

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
  { const tk0 = dkey(Date.now()), open = store.tasks.filter(t => !t.done), left = open.reduce((a, t) => a + Math.max(0, t.est - t.n), 0), doneToday = store.tasks.filter(t => t.done && dkey(t.doneAt) === tk0).length;
    $('tasksSub').textContent = !store.tasks.length ? 'Plan today, then pick a task on the timer.' : `${open.length} open · ${doneToday} done today` + (left ? ` · about ${left} session${left === 1 ? '' : 's'} (${fmtMin(left * settings().focus * 60)}) left` : ''); }
  const l = taskList(), tk = dkey(Date.now());
  const empty = { today: 'Nothing planned for today.\nAdd a task above, then pick it on the Timer screen.', open: 'No open tasks.', done: 'No completed tasks yet.' }[filter];
  $('taskList').innerHTML = l.length ? l.map(t => {
    const meta = [t.est ? `${t.n} of ${t.est} sessions` : t.n ? `${t.n} focus session${t.n === 1 ? '' : 's'}` : '', !t.done && t.day < tk ? 'carried over' : '', PRI[t.pri] + ' priority'].filter(Boolean).join(' · ');
    const est = t.est ? `<span class="estbar" aria-hidden="true">${Array.from({ length: Math.max(t.est, Math.min(t.n, 12)) }, (_, i) => `<i class="${i < t.n ? (i < t.est ? 'd' : 'x') : ''}"></i>`).join('')}</span>` : '';
    const on = timer.task === t.id;
    return `<div class="glass task ${t.done ? 'done' : ''}" data-id="${esc(t.id)}">
      <button class="ck" data-act="toggle" aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}">${ICON_CHECK}</button>
      <button class="tt" data-act="edit">${esc(t.title)}<span class="meta">${esc(meta)}</span>${est}</button>
      <span class="pri p${t.pri}" aria-hidden="true"></span>
      ${t.done ? '' : `<button class="pick ${on ? 'on' : ''}" data-act="focus">${on ? 'Active' : 'Focus'}</button>`}
    </div>`;
  }).join('') : `<div class="empty">${esc(empty).replace(/\n/g, '<br>')}</div>`;
}
$('taskForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('taskInput').value.trim(); if (!v) return;
  store.addTask(v, +$('taskPri').value, +$('taskEstSel').value); $('taskInput').value = ''; $('taskEstSel').value = '0'; audio.play('tap'); renderTasks();
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
      body: `<input type="text" id="edTitle" maxlength="120" value="${esc(t.title)}" aria-label="Task title"><label for="edPri">Priority</label><select id="edPri">${[1, 2, 3].map(p => `<option value="${p}" ${p === t.pri ? 'selected' : ''}>${PRI[p]} priority</option>`).join('')}</select><label for="edEst">Estimated focus sessions</label><select id="edEst">${[0, 1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => `<option value="${n}" ${n === t.est ? 'selected' : ''}>${n ? n + ' session' + (n === 1 ? '' : 's') : 'No estimate'}</option>`).join('')}</select>`,
      buttons: [{ label: 'Delete', value: 'del', cls: 'danger' }, { label: 'Cancel', value: null, cls: 'ghost' }, { label: 'Save', value: 'save', primary: true }]
    });
    if (r === 'save') { const title = $('edTitle').value.trim(); if (title) store.updateTask(id, { title, pri: +$('edPri').value, est: +$('edEst').value }); }
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
    open.map(t => `<button class="opt ${timer.task === t.id ? 'on' : ''}" data-resolve="${esc(t.id)}"><span class="pri p${t.pri}"></span><span class="ot">${esc(t.title)}</span>${t.est ? `<small>${t.n}/${t.est}</small>` : ''}</button>`).join('');
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
const VITALITY = {
  new: ['Fresh start', 'Finish a 10+ min focus session to start Zyn’s journey.'],
  strong: ['Energetic', 'Your routine is strong. Keep the streak alive.'],
  tired: ['Sleepy', 'A couple of days off. One session wakes Zyn up.'],
  lonely: ['Misses you', 'Zyn is waiting. Start with a short session.']
};
const ICON = {
  clock: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8.5"/>', cal: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  avg: '<path d="M4 18l5-6 4 3 7-9"/>', trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>',
  fire: '<path d="M12 3c1 3.5 5 6 5 11a5 5 0 0 1-10 0c0-2.3 1-3.8 2.2-5 .2 1.6.9 2.7 2 3.2C11 9.5 11 6 12 3z"/>', check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  pct: '<path d="M6 18L18 6"/><circle cx="7.5" cy="7.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>', bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  sum: '<path d="M17 5H7l6 7-6 7h10"/>', task: '<path d="M9 7h11M9 12h11M9 17h11M4 7l1 1 2-2M4 12l1 1 2-2M4 17l1 1 2-2"/>'
};
const ic = k => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
let zynSvg = null;
let statsTab = 'focus';
function renderStats() {
  if (statsTab === 'activity') {
    const html = `<h1 class="vtitle">Statistics</h1>${statsTabs()}${activityStatsHTML(store, esc)}`;
    if (html !== lastStats) { lastStats = html; const el = $('statsView'), top = el.scrollTop; el.innerHTML = html; el.scrollTop = top; }
    return;
  }
  const now = Date.now(), live = liveSec(), s = stats(store.history, store.tasks, now, live), xp = store.totalXp(), li = levelInfo(xp), rk = rankInfo(xp);
  const dz = discipline(store.history, now), goal = settings().goal;
  const card = (k, v, u, i, tip) => `<div class="card"><div class="k">${i ? ic(i) : ''}${k}${tip ? `<span class="info-i" data-tip="${esc(tip)}">i</span>` : ''}</div><div class="v">${v}${u ? `<small>${u}</small>` : ''}</div></div>`;
  if (sortedRev !== store.rev) { sortedRev = store.rev; sortedHist = store.history.filter(h => h.m === 'focus').sort((a, b) => b.t - a.t); }
  const tk = dkey(now), yk = agoKey(1);
  let hist = '', lastDay = '';
  for (const h of sortedHist.slice(0, histShown)) {
    const k = dkey(h.t);
    if (k !== lastDay) { lastDay = k; hist += `<div class="hday">${k === tk ? 'Today' : k === yk ? 'Yesterday' : new Date(h.t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>`; }
    const title = h.k && store.taskTitle(h.k);
    hist += `<div class="hrow"><span class="dur">${Math.max(1, Math.round(h.s / 60))}m</span><span class="info">${new Date(h.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${title ? ' · ' + esc(title) : ''}</span>` +
      (h.c ? (h.x ? `<span class="badge ok">+${h.x} XP</span>` : '<span class="badge zero">No XP</span>') : '<span class="badge cut">Interrupted</span>') + '</div>';
  }
  // goal ring
  const gf = Math.min(1, s.todayN / goal), GR = 42, GC = 2 * Math.PI * GR;
  const ring = `<svg viewBox="0 0 100 100" class="gsvg"><circle cx="50" cy="50" r="${GR}" class="gtrack"/><circle cx="50" cy="50" r="${GR}" class="gbar" style="stroke-dasharray:${GC};stroke-dashoffset:${GC * (1 - gf)}"/></svg>`;
  // week bars (minutes), average line, labels only on today + best day
  const max = Math.max(1, ...s.week.map(d => d.sec)), avgPct = s.avg7 / max * 100, bi = s.week.findIndex(d => d.sec === max && d.sec > 0);
  const bars = s.week.map((d, i) => `<div class="col ${i === 6 ? 'today' : ''} ${d.sec > 0 ? 'has' : ''}" data-tip="${new Date(d.k + 'T12:00').toLocaleDateString(undefined, { weekday: 'long' })}: ${d.sec ? fmtMin(d.sec) : 'no focus'}"><b>${(i === 6 || i === bi) && d.sec > 0 ? fmtMin(d.sec) : ''}</b><div class="slot"><i style="height:${Math.max(2, Math.round(d.sec / max * 100))}%"></i></div><span>${'SMTWTFS'[d.dow]}</span></div>`).join('');
  // dayparts
  const dp = dayparts(store.history), dmax = Math.max(...dp), best = dmax > 0 ? dp.indexOf(dmax) : -1;
  const parts = DAYPARTS.map(([n], i) => `<div class="dp ${i === best ? 'best' : ''}" data-tip="${n}: ${fmtMin(dp[i])} total"><span>${n}</span><div class="dpbar"><i style="width:${dmax ? Math.max(dp[i] ? 3 : 0, dp[i] / dmax * 100) : 0}%"></i></div><b>${dp[i] ? fmtMin(dp[i]) : '–'}</b></div>`).join('');
  // calendar heatmap: whole weeks, columns = weeks, rows = Sun..Sat, ending today
  const cells = s.heat.slice(s.heat.length - (77 + dow0(tk) + 1));
  const lvl = d => { const m = d.sec / 60; return m <= 0 ? '' : m < 25 ? 'l1' : m < 60 ? 'l2' : m < 120 ? 'l3' : 'l4'; };
  const heat = cells.map((d, i) => `<i class="${lvl(d)} ${i === cells.length - 1 ? 'now' : ''}" data-tip="${new Date(d.k + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${d.sec ? fmtMin(d.sec) : 'no focus'}"></i>`).join('');
  // discipline: last 14 days
  const d14 = dz.d14.map(d => `<i class="${d.n >= STRONG_DAY ? 'strong' : d.n ? 'act' : ''}" data-tip="${new Date(d.k + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.n} XP session${d.n === 1 ? '' : 's'}"></i>`).join('');
  const [vName, vText] = VITALITY[dz.vitality];
  const stagesRow = STAGES.map(st => `<span class="${st.n <= dz.stage.n ? 'got' : ''} ${st.n === dz.stage.n ? 'cur' : ''}" data-tip="${st.name}: ${st.min} pts · ${st.note}">${st.name.split(' ')[0]}</span>`).join('');
  const ladder = RANKS.map(r => `<span class="${RANKS.indexOf(r) <= RANKS.findIndex(x => x.r === rk.r) ? 'got' : ''} ${r.r === rk.r ? 'cur' : ''}" data-rank="${r.r}" data-tip="Rank ${r.r} · ${r.title} — from level ${r.min}">${r.r}</span>`).join('');
  const html = `<h1 class="vtitle">Statistics</h1>${statsTabs()}
    <div class="card hero2">
      <div class="gring ${gf >= 1 ? 'met' : ''}">${ring}<div class="gin"><b>${s.todayN}</b><small>/ ${goal}</small><span>goal</span></div></div>
      <div class="hstats">
        <div class="k">${live ? '<span class="live"></span>' : ''}Focus today</div>
        <div class="big">${fmtMin(s.todaySec)}</div>
        <div class="hmini"><span><b>+${s.todayXp}</b> XP</span><span><b>${s.todayN}</b> session${s.todayN === 1 ? '' : 's'}</span><span><b>${s.tasksDoneToday}</b> task${s.tasksDoneToday === 1 ? '' : 's'}</span></div>
      </div>
    </div>

    <div class="card zyn">
      <div class="ztop">
        <div class="wolf mini" id="zynStat" data-state="idle" data-stage="${dz.stage.n}" data-mood="${dz.vitality}"></div>
        <div class="zinfo">
          <div class="k">Zyn's evolution</div>
          <div class="zname">${dz.stage.name}<small>Stage ${dz.stage.n} of ${STAGES.length}</small></div>
          <div class="bar"><i style="width:${dz.frac * 100}%"></i></div>
          <div class="zsub">${dz.next ? `<b>${dz.points}</b> / ${dz.next.min} discipline pts → ${dz.next.name}` : `<b>${dz.points}</b> discipline pts · fully evolved`}</div>
          <div class="vit v-${dz.vitality}"><i></i>${vName} — ${vText}</div>
        </div>
      </div>
      <div class="steps">${stagesRow}</div>
      <div class="earn"><span>+1 each active day</span><span>+2 strong day (${STRONG_DAY}+ sessions)</span><span>+2 per best-streak day</span></div>
    </div>

    <div class="card rankc" data-rank="${rk.r}">
      <div class="emblem"><span>${rk.r}</span></div>
      <div class="zinfo">
        <div class="k">Rank</div>
        <div class="zname">${rk.title}<small>Level ${li.level}</small></div>
        <div class="bar"><i style="width:${rk.frac * 100}%"></i></div>
        <div class="zsub">${rk.next ? `${rk.xpToGo.toLocaleString()} XP to Rank ${rk.next.r} · ${rk.next.title} (Lv ${rk.next.min})` : 'Highest rank reached. Legendary.'}</div>
      </div>
      <div class="ladder">${ladder}</div>
    </div>

    <div class="card chart disc">
      <div class="chead"><div><div class="k">Discipline · 14 days</div><div class="big">${dz.score}<small>/100</small></div></div>
        <div class="cnote">Showed up <b>${dz.a14}</b> of 14 days<br><b>${dz.s14}</b> strong days</div></div>
      <div class="d14">${d14}</div>
      <div class="legend"><span><i></i>No focus</span><span><i class="act"></i>Active</span><span><i class="strong"></i>Strong (${STRONG_DAY}+)</span></div>
    </div>

    <div class="card chart">
      <div class="chead"><div class="k">Last 7 days</div><div class="cnote">avg <b>${fmtMin(s.avg7)}</b>/day</div></div>
      <div class="bars">${s.avg7 > 0 ? `<div class="avgline" style="bottom:calc(${avgPct}% * .78 + 22px)"><span>avg</span></div>` : ''}${bars}</div>
    </div>

    <div class="card chart">
      <div class="chead"><div class="k">Best time to focus</div></div>
      <div class="dps">${parts}</div>
      <div class="insight">${best >= 0 ? `You focus best in the <b>${DAYPARTS[best][0].toLowerCase()}</b>. Plan your hardest task then.` : 'Finish a few sessions to discover your best focus time.'}</div>
    </div>

    <div class="card chart">
      <div class="chead"><div class="k">Last 12 weeks</div><div class="legend"><span>Less</span><i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>More</span></div></div>
      <div class="heat">${heat}</div>
    </div>

    <div class="grid">
      ${card('This week', fmtMin(s.weekSec), '', 'cal', 'Focus time from Monday to today')}${card('This month', fmtMin(s.monthSec), '', 'cal', 'Focus time this calendar month')}
      ${card('Daily average', fmtMin(s.avg7), 'last 7 days', 'avg', 'Focus time in the last 7 days (including today) divided by 7')}${card('Avg. session', fmtMin(s.avgSession), '', 'clock', 'Average length of a completed focus session')}
      ${card('Day streak', s.streak, s.streak === 1 ? 'day' : 'days', 'fire', 'Consecutive days with at least one XP-earning focus session')}${card('Best streak', s.best, s.best === 1 ? 'day' : 'days', 'fire')}
      ${card('Sessions done', s.done, '', 'check', 'Completed focus sessions, all time')}${card('Completion', s.rate == null ? '–' : s.rate, s.rate == null ? '' : '%', 'pct', 'Completed ÷ (completed + interrupted) focus sessions')}
      ${card('Total focus', fmtMin(s.totalSec), '', 'clock', 'Every focused minute, including interrupted sessions of 1+ minute')}${card('Total XP', s.totalXp.toLocaleString(), '', 'bolt')}
      ${card('Goal days', goalDays(), 'of last 7', 'trophy', 'Days in the last 7 on which the daily focus goal was met')}${card('Best day', fmtMin(s.bestDay), '', 'trophy', 'Most focus time in a single day')}
      ${card('Tasks done', s.tasksDoneToday, 'today · ' + s.tasksDoneTotal + ' total', 'task')}${card('Consistency', dz.score, '/100', 'avg', '14-day score: 60% days you showed up, 40% strong days (4+ sessions)')}
    </div>
    <div class="section-t">History</div>
    <div class="card hist" style="padding:0 6px 8px">${hist || '<div class="empty">No sessions recorded yet.<br>Finish a focus session and it will appear here.</div>'}</div>
    ${sortedHist.length > histShown ? '<button class="btn-sm ghost" id="moreHist" style="align-self:center">Show more</button>' : ''}
    <p class="fine">Focus time counts every minute actually focused, including interrupted sessions of at least 1 minute. XP, completion rate and streaks follow the rules in Settings. Discipline points only grow — Zyn never loses an evolution.</p>`;
  if (html !== lastStats) {
    lastStats = html;
    const el = $('statsView'), top = el.scrollTop;
    el.innerHTML = html; el.scrollTop = top;
    $('zynStat').innerHTML = zynSvg || (zynSvg = wolfSVG());
  }
}
const dow0 = k => new Date(k + 'T12:00').getDay();
const statsTabs = () => `<div class="seg" id="statsTabs" style="grid-template-columns:1fr 1fr"><button data-t="focus" class="${statsTab === 'focus' ? 'active' : ''}">Focus</button><button data-t="activity" class="${statsTab === 'activity' ? 'active' : ''}">Activity</button></div>`;
// tap a bar / cell / chip for its exact value
let tipT;
function showTip(el) {
  const t = $('tip'), r = el.getBoundingClientRect();
  t.textContent = el.dataset.tip; t.classList.add('show');
  const w = t.offsetWidth, x = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
  t.style.left = x + 'px'; t.style.top = Math.max(8, r.top - t.offsetHeight - 8) + 'px';
  clearTimeout(tipT); tipT = setTimeout(() => t.classList.remove('show'), 2400);
}
$('statsView').addEventListener('click', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); });
$('statsView').addEventListener('scroll', () => $('tip').classList.remove('show'), { passive: true });
$('statsView').onclick = e => {
  if (e.target.id === 'moreHist') { histShown += 30; lastStats = ''; renderStats(); }
  const t = e.target.closest('#statsTabs button'); if (t && t.dataset.t !== statsTab) { statsTab = t.dataset.t; lastStats = ''; $('statsView').scrollTop = 0; renderStats(); }
};

/* ---------- settings ---------- */
const NUM = { focus: 's-focus', short: 's-short', long: 's-long', rounds: 's-rounds', goal: 's-goal' }, BOOLS = { auto: 's-auto', sound: 's-sound', ticks: 's-ticks', alarm: 's-alarm', notify: 's-notify', calm: 's-calm', wolf: 's-wolf', voice: 's-voice', chatty: 's-chatty', stt: 's-stt', chatSave: 's-chatSave' };
function notifyNote() {
  if (!('Notification' in window)) return 'Not supported in this browser.';
  const p = Notification.permission;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (p === 'denied') return 'Blocked. Turn on in iPhone Settings → Notifications → ZENTRY.';
  if (ios && !standalone) return 'On iPhone, add ZENTRY to your Home Screen first (Share → Add to Home Screen), then turn this on.';
  return 'Banner at the top of the screen when a session or break ends. Tip: iPhone Settings → Notifications → ZENTRY → Banner Style: Persistent keeps it on screen.';
}
function renderSettings() {
  const s = settings();
  for (const k in NUM) $(NUM[k]).value = s[k];
  for (const k in BOOLS) $(BOOLS[k]).checked = s[k];
  $('s-volume').value = s.volume; $('s-ambient').value = s.ambient; $('s-ambVol').value = s.ambVol;
  document.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.dataset.a === s.accent));
  $('notifyNote').textContent = notifyNote();
  $('dataNote').textContent = `${store.history.length} sessions · ${store.activities.length} activities · ${store.tasks.length} tasks · saved on this device` + (volatile ? ' — WARNING: storage is blocked, data will be lost when you close the app' : '');
  $('bgGrid').innerHTML = BACKGROUNDS.map(b => `<button type="button" class="bgopt ${b === s.bg ? 'on' : ''}" data-bg="${b}" aria-pressed="${b === s.bg}" aria-label="${BG_NAMES[b]} background"><span class="bgfill" data-bg="${b}"></span><span>${BG_NAMES[b]}</span></button>`).join('');
  $('s-voiceVol').value = s.voiceVol;
  const vs = voice.voices(); $('s-voiceName').innerHTML = '<option value="">Automatic (best available)</option>' + vs.map(v => `<option value="${esc(v.name)}" ${v.name === s.voiceName ? 'selected' : ''}>${esc(v.name)}${v.local ? '' : ' (online)'}</option>`).join('');
  $('voiceNote').textContent = 'Zyn speaks on its own at key moments: when you open the app, start, finish, take a break, hit a goal. The words always appear in the speech bubble.';
  document.querySelectorAll('#voiceStyle button').forEach(b => { b.classList.toggle('active', b.dataset.v === s.voiceStyle); b.disabled = b.dataset.v === 'device' && !voice.deviceSupported; });
  document.querySelectorAll('#voicePitch button').forEach(b => b.classList.toggle('active', b.dataset.p === s.voicePitch));
  $('pitchRow').hidden = s.voiceStyle !== 'zyn'; $('deviceVoiceRow').hidden = s.voiceStyle !== 'device';
  $('presets').innerHTML = presetButtons('wide');
  $('sttNote').textContent = listener.supported ? 'Talk instead of typing. You review the text before sending. Recognition is done by your browser/phone (Apple or Google may process the audio).' : 'Voice input is not supported in this browser.';
  $('s-stt').disabled = !listener.supported;
  const gl = Object.entries(store.goals);
  $('goalList').innerHTML = gl.map(([n, g]) => `<div class="goalrow2"><span>${esc(labelOf(n))}</span><b>${esc(fmtQty(g.qty, g.unit))}/day</b><button class="btn-sm ghost" type="button" data-goal="${esc(n)}">Edit</button></div>`).join('')
    + `<div class="goalrow2"><span class="muted">${gl.length ? '' : 'No activity goals yet.'}</span><button class="btn-sm" type="button" data-goal="">Add goal</button></div>`;
  renderAI();
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
for (const k in BOOLS) if (k !== 'notify') $(BOOLS[k]).addEventListener('change', e => { applySettings({ [k]: e.target.checked }); if (k === 'sound' && e.target.checked) { audio.unlock(); audio.play('tap'); } if (k === 'voice' && e.target.checked) voiceDemo(); if (k === 'voice' && !e.target.checked) voice.stop(); });
$('s-notify').addEventListener('change', async e => {
  if (e.target.checked) {
    let p = 'denied';
    try { if ('Notification' in window) p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission; } catch (_) {}
    if (p !== 'granted') { e.target.checked = false; toast('Notifications are not allowed for this app'); applySettings({ notify: false }); return; }
    applySettings({ notify: true }); toast('Notifications on');
  } else applySettings({ notify: false });
});
let vt; $('s-volume').addEventListener('input', e => { store.setSettings({ volume: +e.target.value }); clearTimeout(vt); vt = setTimeout(() => { audio.unlock(); audio.play('tap'); }, 90); });
$('testNotify').onclick = async () => {
  if (!('Notification' in window)) return toast('Notifications are not supported here');
  let p = Notification.permission;
  try { if (p === 'default') p = await Notification.requestPermission(); } catch (e) {}
  if (p !== 'granted') return toast('Allow notifications first');
  notify('🐺 ZENTRY', 'Notifications work! You will see this when a session ends.', true); audio.unlock(); audio.play('breakDone');
};
$('s-ambient').addEventListener('change', e => { audio.unlock(); applySettings({ ambient: e.target.value }); });
$('s-ambVol').addEventListener('input', e => { store.setSettings({ ambVol: +e.target.value }); syncAmbient(); });
$('swatches').onclick = e => { const b = e.target.closest('.sw'); if (b) applySettings({ accent: b.dataset.a }); };
$('bgGrid').onclick = e => { const b = e.target.closest('.bgopt'); if (b) { applySettings({ bg: b.dataset.bg }); audio.unlock(); audio.play('tap'); } };
const voiceDemo = () => { audio.unlock(); voice.speak('Hi! I’m Zyn. Let’s focus together!', { force: true, priority: true, mood: 'excited', sound: 'yipyip' }); };
$('s-voiceVol').addEventListener('change', e => { store.setSettings({ voiceVol: +e.target.value }); voiceDemo(); });
$('s-voiceName').addEventListener('change', e => { store.setSettings({ voiceName: e.target.value }); voiceDemo(); });
$('voiceStyle').onclick = e => { const b = e.target.closest('button'); if (b) { applySettings({ voiceStyle: b.dataset.v }); voiceDemo(); } };
$('voicePitch').onclick = e => { const b = e.target.closest('button'); if (b) { applySettings({ voicePitch: b.dataset.p }); voiceDemo(); } };
$('presets').onclick = e => { const b = e.target.closest('[data-preset]'); if (b) applyPreset(b.dataset.preset); };
$('voiceTest').onclick = voiceDemo;
$('goalList').onclick = e => { const b = e.target.closest('[data-goal]'); if (b) track.goalDialog(b.dataset.goal || undefined); };

/* ---------- AI assistant settings ---------- */
const webllm = createWebLLMEngine(() => settings().aiModel);
const server = createServerEngine(() => ({ url: settings().aiUrl, api: settings().aiApi, model: settings().aiServerModel }));
const engines = { rules: rulesEngine, webllm, server };
async function renderAI() {
  const s = settings();
  document.querySelectorAll('#aiEngines input').forEach(r => { r.checked = r.value === s.ai; });
  $('aiWebllm').hidden = s.ai !== 'webllm'; $('aiServer').hidden = s.ai !== 'server';
  $('s-aiModel').innerHTML = WEBLLM_MODELS.map(m => `<option value="${m.id}" ${m.id === s.aiModel ? 'selected' : ''}>${m.name} — ${m.size}</option>`).join('');
  $('s-aiUrl').value = s.aiUrl; $('s-aiApi').value = s.aiApi; $('s-aiServerModel').value = s.aiServerModel;
  $('serverNote').textContent = isPrivateUrl(s.aiUrl) ? 'Your messages go only to this address on your device or local network.' : '⚠ This address is not on your device or local network — your messages would be sent there.';
  $('webllmLoad').disabled = !webllm.supported() || webllm.loaded;
  $('webllmStatus').textContent = (await webllm.status()).text;
  aiStatus();
}
async function aiStatus() {
  const s = settings(), e = engines[s.ai];
  if (s.ai === 'rules') return chat.status('Built-in parser · offline · private');
  const st = await e.status();
  chat.status(`${e.name}${st.ready ? '' : ' (not ready — using built-in parser)'}${e.private ? ' · private' : ' · ⚠ remote'}`);
}
$('aiEngines').addEventListener('change', e => { if (e.target.name === 'ai') { store.setSettings({ ai: e.target.value }); renderAI(); } });
$('s-aiModel').addEventListener('change', e => { store.setSettings({ aiModel: e.target.value }); webllm.unload(); renderAI(); });
for (const [id, key] of [['s-aiUrl', 'aiUrl'], ['s-aiApi', 'aiApi'], ['s-aiServerModel', 'aiServerModel']]) $(id).addEventListener('change', e => { store.setSettings({ [key]: e.target.value.trim() }); renderAI(); });
$('serverTest').onclick = async () => { $('serverStatus').textContent = 'Testing…'; $('serverStatus').textContent = (await server.status()).text; };
webllm.onProgress(() => { $('webllmStatus').textContent = webllm.progress || '…'; $('webllmBar').hidden = !webllm.progress || webllm.progress === 'Ready'; });
$('webllmLoad').onclick = async () => {
  const m = WEBLLM_MODELS.find(x => x.id === settings().aiModel);
  const ok = await dialog({ title: 'Download the AI model?', text: `${m.name}: ${m.size}.\nIt downloads once (Wi-Fi recommended), is stored on this device and then works offline. Your messages never leave the device.`, buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Download', value: true, primary: true }] });
  if (ok !== true) return;
  $('webllmLoad').disabled = true; $('webllmBar').hidden = false;
  try { await webllm.load(); toast('On-device model ready'); } catch (e) { toast('Could not load the model: ' + e.message, 5000); }
  $('webllmBar').hidden = true; renderAI();
};
$('webllmRemove').onclick = async () => {
  const ok = await dialog({ title: 'Remove the downloaded model?', text: 'Frees the storage it uses. Zyn falls back to the built-in parser.', buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Remove', value: true, cls: 'danger' }] });
  if (ok !== true) return;
  try { await webllm.remove(); toast('Model removed'); } catch (e) { toast('Nothing to remove'); }
  renderAI();
};

/* ---------- backup / restore / reset ---------- */
$('exportBtn').onclick = async () => {
  const data = JSON.stringify(store.exportData(), null, 1), name = `zentry-backup-${dkey(Date.now())}.json`;
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
  if (f.size > 25e6) return fail('That file is too large to be a ZENTRY backup.');
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
  applyTheme(); renderAll(); toast(r === 'merge' ? `Merged ${res.sessions} sessions, ${res.activities} activities, ${res.tasks} tasks` : `Restored ${res.sessions} sessions, ${res.activities} activities, ${res.tasks} tasks`);
};
$('wipeBtn').onclick = async () => {
  const r = await dialog({
    title: 'Reset all data?', text: `This permanently erases ${store.history.length} sessions, ${store.tasks.length} tasks, your XP, level and settings on this device.\n\nExport a backup first if you may want it back.`,
    buttons: [{ label: 'Cancel', value: false, cls: 'ghost', primary: true }, { label: 'Erase everything', value: true, cls: 'danger' }]
  });
  if (r !== true) return;
  store.resetAll(); unlockScreen(); timer = store.timer; store.saveTimer(timer); histShown = 20; assistant.reset(); applyTheme(); renderAll(); chat.render(); toast('All data erased');
};

/* ---------- offline / update / install ---------- */
async function offlineStatus() {
  let txt = 'Not ready yet — open the app once while online.';
  try { if ('serviceWorker' in navigator && navigator.serviceWorker.controller && (await caches.keys()).some(k => k.startsWith('zentry-'))) txt = 'Ready — works without internet.'; } catch (e) {}
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
const LOCAL_ONLY = ['sl.greetAt', 'sl.v7', 'sl.voiceDay', 'sl.evo', 'sl.prerestore'];      // per-tab bookkeeping, not user data
addEventListener('storage', e => { if (e.key && e.key.startsWith('sl.') && !e.key.endsWith('.corrupt') && !LOCAL_ONLY.includes(e.key) && !$('dlg').classList.contains('open')) location.reload(); });

/* ---------- assistant: timer commands it may use (same guards as the buttons) ---------- */
const startTimer = start, pauseTimer = pause;
const timerApi = {
  start({ mode = 'focus', minutes = null } = {}) {
    if (timer.running) return { ok: false, text: `A ${NAMES[timer.mode].toLowerCase()} is already running (${fmtClock(TM.remaining(timer, Date.now()))} left). Say “pause” to pause it.` };
    if (TM.inProgress(timer) && timer.mode === 'focus' && TM.elapsed(timer, Date.now()) >= 10000) return { ok: false, text: 'You have a paused focus session. Say “resume” — or reset it on the timer first.' };
    setTimer(TM.newTimer({ ...settings(), [mode]: minutes || settings()[mode] }, mode, timer.completed, timer.task));
    startTimer(); renderAll();
    return { ok: true, text: `${NAMES[mode]} started — ${Math.round(timer.total / 60000)} minutes.${mode === 'focus' ? ' I’ll keep watch. 🐺' : ' Relax.'}` };
  },
  pause() { if (!timer.running) return { ok: false, text: 'Nothing is running right now.' }; pauseTimer(); return { ok: true, text: `Paused with ${fmtClock(TM.remaining(timer, Date.now()))} left.` }; },
  resume() { if (timer.running) return { ok: false, text: 'The timer is already running.' }; if (!TM.inProgress(timer)) return { ok: false, text: 'There’s no paused session. Say “start a focus session”.' }; startTimer(); return { ok: true, text: 'Resumed. Back to it.' }; },
  reset() { if (needsConfirm()) return { ok: false, text: 'That would abandon your focus session. If you really want that, use the reset button on the timer.' }; abandonCurrent(); resetTo(timer.mode); return { ok: true, text: 'Timer reset.' }; },
  skip() { if (needsConfirm()) return { ok: false, text: 'That would abandon your focus session. Use the skip button on the timer if you mean it.' }; abandonCurrent(); resetTo(timer.mode === 'focus' ? 'short' : 'focus'); return { ok: true, text: `Switched to ${NAMES[timer.mode].toLowerCase()}.` }; },
  liveFocusSec: () => liveSec()
};
const assistant = createAssistant({ store, engines, timer: timerApi });

// a record was saved (chat or Track): refresh everything from the store and let Zyn react to real progress
function activityEvent(records) {
  if (!records || !records.length) return;
  const today = dkey(Date.now()), prog = goalProgress(store.activities, store.goals, today);
  const reached = prog.filter(g => g.met && records.some(r => r.name === g.name && r.unit === g.unit && r.day === today) &&
    g.done - records.filter(r => r.name === g.name && r.unit === g.unit && r.day === today).reduce((a, r) => a + r.qty, 0) < g.target);
  if (reached.length) { wolf.react('howl', 3200, [`${reached[0].label} goal reached! Awoo!`, 'excited', 'awoo'], { priority: true }); audio.play('levelUp'); }
  else { wolf.react('happy', 2200, null); audio.play('task'); voice.speak('', { sound: 'yip', mood: 'happy' }); }
}
const chat = initChat({ store, assistant, $, wolfSVG, listener, toast, dialog,
  onReply: r => { if (r.kind === 'saved') { renderAll(); activityEvent(r.records); } } });
const track = initTrack({ store, $, esc, toast, dialog, onChange: r => { renderAll(); if (r && r.records) activityEvent(r.records); } });

/* ---------- boot ---------- */
function renderAll() { renderTimer(); renderChip(); if (view === 'tasksView') renderTasks(); if (view === 'statsView') { lastStats = ''; renderStats(); } if (view === 'settingsView') renderSettings(); if (view === 'trackView') track.render(); if (view === 'chatView') chat.micVisible(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); renderTimer(); lockScreen(); } });

try {
  if (!localStorage.getItem('sl.v7')) {
    localStorage.setItem('sl.v7', '1');
    const s0 = settings(), patch = {};
    if (s0.bg === 'aurora') patch.bg = 'den';
    if (s0.accent === 'blue') patch.accent = 'gold';
    if (Object.keys(patch).length) store.setSettings(patch);
  }
} catch (e) {}
applyTheme();
if (settings().notify && (!('Notification' in window) || Notification.permission !== 'granted')) store.setSettings({ notify: false });
if (timer.completed >= settings().rounds) timer = { ...timer, completed: 0 };
renderAll();
booted = true;
// Zyn greets you by itself when the app opens (at most every 20 minutes). Browsers only allow sound after the first
// tap, so on a cold start the bubble shows right away and the voice follows on your first touch.
setTimeout(() => {
  const v = discipline(store.history, Date.now()).vitality, h = new Date().getHours(), base = wolfBase();
  let l;
  if (timer.running) l = wolf.line(timer.mode === 'focus' ? 'focus' : 'rest');
  else if (base === 'proud') l = wolf.line('proud');
  else if (base === 'serious') l = wolf.line('serious');
  else if (v === 'tired' || v === 'lonely') l = wolf.line(v);
  else { const [t, m, snd] = wolf.line('idle'); l = [(h < 5 ? 'Late hunt? ' : h < 12 ? 'Good morning! ' : h < 18 ? 'Hey there! ' : 'Good evening! ') + t, m, snd || 'yip']; }
  let last = 0; try { last = +localStorage.getItem('sl.greetAt') || 0; } catch (e) {}
  const speakIt = Date.now() - last > 20 * 60000;
  if (speakIt) try { localStorage.setItem('sl.greetAt', String(Date.now())); } catch (e) {}
  wolf.say(l, { voice: speakIt, priority: true });
}, 900);
lastBase = wolfBase();
{ const qv = new URLSearchParams(location.search).get('view'); if (['timerView', 'tasksView', 'chatView', 'trackView', 'statsView', 'settingsView'].includes(qv)) go(qv); }   // home-screen shortcuts
setInterval(tick, 250);
if (timer.running) { lockScreen(); tick(); }
if (store.warnings.length) setTimeout(() => toast('Some saved data could not be read. A copy was kept on this device.', 5000), 600);
try { if (sessionStorage.getItem('sl.updated')) { sessionStorage.removeItem('sl.updated'); setTimeout(() => toast('Updated to v' + APP_VERSION + ' — your data is safe'), 600); } } catch (e) {}
