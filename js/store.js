// Local data layer: validation, migration, dedupe, tasks, backup/restore.
// `storage` is anything with getItem/setItem/removeItem (localStorage, or a Map-backed mock in tests).
import { dkey, xpFor } from './rpg.js';

export const DATA_VERSION = 2;
export const MODES = ['focus', 'short', 'long'];
export const ACCENTS = ['blue', 'violet', 'crimson', 'gold'];
export const AMBIENTS = ['off', 'rain', 'brown', 'waves', 'white'];
export const DEFAULT_SETTINGS = { focus: 25, short: 5, long: 15, rounds: 4, goal: 6, auto: false, sound: true, volume: 70, ticks: true, notify: false, accent: 'blue', black: false, calm: false, wolf: true, ambient: 'off', ambVol: 50 };
const LIM = { focus: [1, 180], short: [1, 60], long: [1, 90], rounds: [2, 10], goal: [1, 20] };
const BOOL = ['auto', 'sound', 'ticks', 'notify', 'black', 'calm', 'wolf'];
export const BACKUP_APPS = ['zyntry', 'solo-leveling'];   // backups from the app's previous name still import
const KEYS = { settings: 'sl.settings', timer: 'sl.timer', history: 'sl.history', tasks: 'sl.tasks', meta: 'sl.meta' };

const clampInt = (v, [a, b], d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- validators ---------- */
export function cleanSettings(s) {
  s = s && typeof s === 'object' ? s : {};
  const o = { ...DEFAULT_SETTINGS };
  for (const k in LIM) o[k] = clampInt(s[k], LIM[k], DEFAULT_SETTINGS[k]);
  for (const k of BOOL) if (typeof s[k] === 'boolean') o[k] = s[k];
  o.volume = clampInt(s.volume, [0, 100], DEFAULT_SETTINGS.volume);
  o.ambVol = clampInt(s.ambVol, [0, 100], DEFAULT_SETTINGS.ambVol);
  if (ACCENTS.includes(s.accent)) o.accent = s.accent;
  if (AMBIENTS.includes(s.ambient)) o.ambient = s.ambient;
  return o;
}
export function cleanSession(h) {
  if (!h || typeof h !== 'object') return null;
  const t = Number(h.t), s = Number(h.s);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(s) || s < 0 || s > 86400 || !MODES.includes(h.m)) return null;
  const c = h.c ? 1 : 0, sec = Math.round(s);
  const id = typeof h.id === 'string' && h.id && h.id.length < 80 ? h.id : `legacy-${Math.round(t)}-${h.m}-${sec}`;
  const xn = Number(h.x);
  const x = Number.isFinite(xn) ? Math.max(0, Math.min(1000, Math.round(xn))) : xpFor(h.m, sec, !!c);
  const e = { id, t: Math.round(t), m: h.m, s: sec, c, x };
  if (typeof h.k === 'string' && h.k && h.k.length < 60) e.k = h.k;
  return e;
}
export function cleanTask(t) {
  if (!t || typeof t !== 'object') return null;
  const title = typeof t.title === 'string' ? t.title.trim().slice(0, 120) : '';
  if (!title) return null;
  const created = Number.isFinite(Number(t.created)) && Number(t.created) > 0 ? Math.round(Number(t.created)) : Date.now();
  const done = !!t.done;
  const doneAt = done ? (Number.isFinite(Number(t.doneAt)) && Number(t.doneAt) > 0 ? Math.round(Number(t.doneAt)) : created) : null;
  return {
    id: typeof t.id === 'string' && t.id && t.id.length < 60 ? t.id : uid(),
    title, pri: [1, 2, 3].includes(Number(t.pri)) ? Number(t.pri) : 2, done, doneAt, created,
    day: typeof t.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.day) ? t.day : dkey(created),
    n: clampInt(t.n, [0, 100000], 0)
  };
}
export function cleanTimer(r, s) {
  r = r && typeof r === 'object' ? r : {};
  const mode = MODES.includes(r.mode) ? r.mode : 'focus';
  let total = Number(r.total);
  if (!Number.isFinite(total) || total < 1000 || total > 180 * 60000) total = s[mode] * 60000;
  let rem = Number(r.remaining);
  if (!Number.isFinite(rem) || rem < 0 || rem > total) rem = total;
  const endAt = Number(r.endAt);
  const running = !!r.running && Number.isFinite(endAt) && endAt > 0;
  return {
    mode, running, endAt: running ? endAt : 0, remaining: rem, total,
    sid: typeof r.sid === 'string' && r.sid && r.sid.length < 80 ? r.sid : null,
    completed: clampInt(r.completed, [0, 99], 0),
    task: typeof r.task === 'string' && r.task ? r.task : null
  };
}
function dedupe(list, keyOf) { const seen = new Set(), out = []; for (const x of list) { const k = keyOf(x); if (!seen.has(k)) { seen.add(k); out.push(x); } } return out; }

/* ---------- backup parsing (pure) ---------- */
export function parseBackup(obj) {
  if (!obj || typeof obj !== 'object' || !BACKUP_APPS.includes(obj.app)) throw new Error('This file is not a Zyntry backup.');
  if (Number(obj.version) > DATA_VERSION) throw new Error('This backup was made by a newer version of the app. Update the app first.');
  if (!Array.isArray(obj.history) || !Array.isArray(obj.tasks)) throw new Error('The backup is missing session or task data.');
  const sessions = dedupe(obj.history.map(cleanSession).filter(Boolean), s => s.id);
  const tasks = dedupe(obj.tasks.map(cleanTask).filter(Boolean), t => t.id);
  return { sessions, tasks, settings: obj.settings ? cleanSettings(obj.settings) : null, rejected: (obj.history.length - sessions.length) + (obj.tasks.length - tasks.length) };
}

/* ---------- the store ---------- */
export function createStore(storage) {
  const warnings = [];
  let writeFailed = false;

  const readJSON = key => {
    let raw;
    try { raw = storage.getItem(key); } catch (e) { return undefined; }
    if (raw == null) return undefined;
    try { return JSON.parse(raw); }
    catch (e) { try { storage.setItem(key + '.corrupt', raw); } catch (_) {} warnings.push(key); return undefined; } // keep a copy, never silently discard
  };
  const writeJSON = (key, v) => { try { storage.setItem(key, JSON.stringify(v)); return true; } catch (e) { writeFailed = true; return false; } };

  const S = { settings: null, timer: null, history: [], tasks: [], ids: new Set(), rev: 0, warnings, get writeFailed() { return writeFailed; } };

  /* load + one-time, non-destructive migration from v1 keys (they are left in place) */
  const meta = readJSON(KEYS.meta) || {};
  let settings = readJSON(KEYS.settings), timer = readJSON(KEYS.timer), history = readJSON(KEYS.history), tasks = readJSON(KEYS.tasks);
  if (!meta.migrated && settings === undefined && history === undefined && timer === undefined) {
    const oldState = readJSON('sololeveling.state.v1'), oldHist = readJSON('sololeveling.history.v1');
    if (oldState && typeof oldState === 'object') {
      settings = oldState.settings;
      const r = cleanSettings(settings);
      const run = !!oldState.running && Number(oldState.endAt) > 0;
      timer = { mode: oldState.mode, running: run, endAt: oldState.endAt, remaining: oldState.remaining, completed: oldState.completed,
        sid: (run || Number(oldState.remaining) < r[MODES.includes(oldState.mode) ? oldState.mode : 'focus'] * 60000) ? `legacy-${Math.round(Number(oldState.endAt) || Date.now())}-${oldState.mode}` : null };
    }
    if (Array.isArray(oldHist)) history = oldHist;
  }
  S.settings = cleanSettings(settings);
  S.timer = cleanTimer(timer, S.settings);
  S.history = dedupe((Array.isArray(history) ? history : []).map(cleanSession).filter(Boolean), s => s.id);
  S.tasks = dedupe((Array.isArray(tasks) ? tasks : []).map(cleanTask).filter(Boolean), t => t.id);
  S.ids = new Set(S.history.map(h => h.id));
  if (!meta.migrated) {            // first run (or first run after upgrading): persist what was loaded/migrated
    writeJSON(KEYS.settings, S.settings); writeJSON(KEYS.timer, S.timer);
    writeJSON(KEYS.history, S.history); writeJSON(KEYS.tasks, S.tasks);
  }
  writeJSON(KEYS.meta, { migrated: true, v: DATA_VERSION });

  const touch = () => { S.rev++; };
  const saveHistory = () => { touch(); return writeJSON(KEYS.history, S.history); };
  const saveTasks = () => { touch(); return writeJSON(KEYS.tasks, S.tasks); };

  S.setSettings = patch => { S.settings = cleanSettings({ ...S.settings, ...patch }); touch(); writeJSON(KEYS.settings, S.settings); return S.settings; };
  S.saveTimer = t => { S.timer = t; return writeJSON(KEYS.timer, t); };
  S.totalXp = () => S.history.reduce((a, h) => a + h.x, 0);

  // Returns false (and changes nothing) if a session with this id was already recorded.
  S.addSession = e => {
    const c = cleanSession(e);
    if (!c || S.ids.has(c.id)) return false;
    S.ids.add(c.id); S.history.push(c);
    saveHistory();
    return true;
  };

  /* tasks */
  S.addTask = (title, pri = 2) => {
    const t = cleanTask({ id: uid(), title, pri, created: Date.now() });
    if (!t) return null;
    S.tasks.push(t); saveTasks(); return t;
  };
  S.updateTask = (id, patch) => {
    const i = S.tasks.findIndex(t => t.id === id); if (i < 0) return null;
    const next = cleanTask({ ...S.tasks[i], ...patch, id });
    if (!next) return null;
    S.tasks[i] = next; saveTasks(); return next;
  };
  S.setTaskDone = (id, done) => {
    const t = S.tasks.find(x => x.id === id); if (!t) return null;
    return S.updateTask(id, { done, doneAt: done ? Date.now() : null });
  };
  S.deleteTask = id => { const n = S.tasks.length; S.tasks = S.tasks.filter(t => t.id !== id); if (S.tasks.length !== n) saveTasks(); return S.tasks.length !== n; };
  S.bumpTask = id => { const t = S.tasks.find(x => x.id === id); if (t) { t.n++; saveTasks(); } };
  S.taskTitle = id => { const t = S.tasks.find(x => x.id === id); return t ? t.title : null; };

  /* backup / restore / reset */
  S.exportData = () => ({
    app: 'zyntry', version: DATA_VERSION, exportedAt: new Date().toISOString(),
    settings: S.settings, history: S.history, tasks: S.tasks, summary: { sessions: S.history.length, tasks: S.tasks.length, totalXp: S.totalXp() }
  });
  S.importData = (parsed, how) => {
    if (how === 'replace') {
      try { storage.setItem('sl.prerestore', JSON.stringify(S.exportData())); } catch (e) {}   // safety copy of what is being replaced
      S.history = parsed.sessions.slice(); S.tasks = parsed.tasks.slice();
      if (parsed.settings) { S.settings = parsed.settings; writeJSON(KEYS.settings, S.settings); }
      S.ids = new Set(S.history.map(h => h.id));
      saveHistory(); saveTasks();
      return { sessions: S.history.length, tasks: S.tasks.length };
    }
    let a = 0, b = 0;
    for (const s of parsed.sessions) if (!S.ids.has(s.id)) { S.ids.add(s.id); S.history.push(s); a++; }
    const tids = new Set(S.tasks.map(t => t.id));
    for (const t of parsed.tasks) if (!tids.has(t.id)) { S.tasks.push(t); b++; }
    if (a) saveHistory(); if (b) saveTasks();
    return { sessions: a, tasks: b };
  };
  S.resetAll = () => {
    for (const k of [KEYS.settings, KEYS.timer, KEYS.history, KEYS.tasks]) { try { storage.removeItem(k); } catch (e) {} }
    S.settings = cleanSettings(null); S.timer = cleanTimer(null, S.settings); S.history = []; S.tasks = []; S.ids = new Set();
    writeJSON(KEYS.settings, S.settings); writeJSON(KEYS.timer, S.timer); writeJSON(KEYS.history, S.history); writeJSON(KEYS.tasks, S.tasks);
    writeJSON(KEYS.meta, { migrated: true, v: DATA_VERSION });   // prevents old v1 data from being re-imported
    touch();
  };
  return S;
}
