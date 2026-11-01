// Local data layer: validation, migration, dedupe, tasks, backup/restore.
// `storage` is anything with getItem/setItem/removeItem (localStorage, or a Map-backed mock in tests).
import { dkey, dayNum, xpFor } from './rpg.js';
import { UNITS, CATEGORIES, HARD_MAX, labelOf, catOf } from './catalog.js';

export const DATA_VERSION = 3;
export const MODES = ['focus', 'short', 'long'];
export const ACCENTS = ['blue', 'violet', 'crimson', 'gold'];
export const AMBIENTS = ['off', 'rain', 'brown', 'waves', 'white'];
export const BACKGROUNDS = ['den', 'aurora', 'amoled', 'charcoal', 'midnight', 'purple', 'gradient', 'wolf', 'mountains', 'forest', 'light'];
export const AI_ENGINES = ['rules', 'webllm', 'server'];
export const DEFAULT_SETTINGS = { focus: 25, short: 5, long: 15, rounds: 4, goal: 6, auto: false, sound: true, volume: 70, ticks: true, alarm: true, notify: false, accent: 'gold', black: false, calm: false, wolf: true, ambient: 'off', ambVol: 50,
  bg: 'den', voice: true, voiceVol: 80, voiceName: '', voiceStyle: 'zyn', voicePitch: 'pup', chatty: true, stt: true, chatSave: true,
  ai: 'rules', aiModel: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', aiUrl: 'http://localhost:11434', aiApi: 'ollama', aiServerModel: 'qwen2.5:1.5b' };
const LIM = { focus: [1, 180], short: [1, 60], long: [1, 90], rounds: [2, 10], goal: [1, 20] };
const BOOL = ['auto', 'sound', 'ticks', 'alarm', 'notify', 'black', 'calm', 'wolf', 'voice', 'chatty', 'stt', 'chatSave'];
export const BACKUP_APPS = ['zentry', 'zyntry', 'solo-leveling'];   // backups from the app's previous names still import
// storage keys keep the original 'sl.' prefix so existing installs keep their data
const KEYS = { settings: 'sl.settings', timer: 'sl.timer', history: 'sl.history', tasks: 'sl.tasks', meta: 'sl.meta', activities: 'sl.activities', goals: 'sl.goals', chat: 'sl.chat', audit: 'sl.audit' };
export const SOURCES = ['manual', 'chat', 'voice', 'import'];

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
  o.voiceVol = clampInt(s.voiceVol, [0, 100], DEFAULT_SETTINGS.voiceVol);
  if (BACKGROUNDS.includes(s.bg)) o.bg = s.bg; else if (s.black === true) o.bg = 'amoled';     // migrate the old "pure black" switch
  if (s.voiceStyle === 'zyn' || s.voiceStyle === 'device') o.voiceStyle = s.voiceStyle;
  if (s.voicePitch === 'pup' || s.voicePitch === 'low') o.voicePitch = s.voicePitch;
  if (AI_ENGINES.includes(s.ai)) o.ai = s.ai;
  if (s.aiApi === 'openai' || s.aiApi === 'ollama') o.aiApi = s.aiApi;
  for (const [k, n] of [['voiceName', 120], ['aiModel', 100], ['aiServerModel', 100]]) if (typeof s[k] === 'string' && s[k].length <= n) o[k] = s[k];
  if (typeof s.aiUrl === 'string' && /^https?:\/\/[^\s]{1,200}$/.test(s.aiUrl)) o.aiUrl = s.aiUrl.replace(/\/+$/, '');
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
  if (h.man) { e.man = 1; e.x = 0; }                             // logged by hand (chat): counts as focus time, never earns XP
  return e;
}
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validKey = k => typeof k === 'string' && KEY_RE.test(k) && !isNaN(dayNum(k)) && dkey(new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), 12).getTime()) === k;
/** One recorded activity. Returns null if anything is invalid — invalid data is never stored. */
export function cleanActivity(a) {
  if (!a || typeof a !== 'object') return null;
  const name = typeof a.name === 'string' ? a.name.toLowerCase().replace(/\s+/g, ' ').trim() : '';
  if (!/^[a-z0-9][a-z0-9 '-]{0,39}$/.test(name)) return null;
  const unit = UNITS[a.unit] ? a.unit : null, qty = Number(a.qty);
  if (!unit || !Number.isFinite(qty) || qty <= 0 || qty > HARD_MAX[unit]) return null;
  if (!validKey(a.day)) return null;
  const at = Number(a.at) > 0 ? Math.round(Number(a.at)) : new Date(+a.day.slice(0, 4), +a.day.slice(5, 7) - 1, +a.day.slice(8, 10), 12).getTime();
  const created = Number(a.created) > 0 ? Math.round(Number(a.created)) : Date.now();
  const o = {
    id: typeof a.id === 'string' && /^[\w-]{4,60}$/.test(a.id) ? a.id : 'a-' + uid(),
    name, label: typeof a.label === 'string' && a.label.trim() ? a.label.trim().slice(0, 60) : labelOf(name),
    cat: CATEGORIES.includes(a.cat) ? a.cat : catOf(name), qty: Math.round(qty * 100) / 100, unit, day: a.day, at,
    src: SOURCES.includes(a.src) ? a.src : 'manual', created, updated: Number(a.updated) > 0 ? Math.round(Number(a.updated)) : created
  };
  if (typeof a.note === 'string' && a.note.trim()) o.note = a.note.trim().slice(0, 80);
  if (a.custom === true || o.cat === 'custom') o.custom = true;
  return o;
}
export function cleanGoals(g) {
  const out = {};
  if (!g || typeof g !== 'object') return out;
  for (const [name, v] of Object.entries(g).slice(0, 40)) {
    if (!/^[a-z0-9][a-z0-9 '-]{0,39}$/.test(name) || !v || !UNITS[v.unit]) continue;
    const q = Number(v.qty); if (Number.isFinite(q) && q > 0 && q <= HARD_MAX[v.unit]) out[name] = { qty: Math.round(q * 100) / 100, unit: v.unit };
  }
  return out;
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
    n: clampInt(t.n, [0, 100000], 0),
    est: clampInt(t.est, [0, 20], 0)            // estimated focus sessions (0 = no estimate)
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
  const rawActs = Array.isArray(obj.activities) ? obj.activities : [];
  const activities = dedupe(rawActs.map(cleanActivity).filter(Boolean), a => a.id);
  return { sessions, tasks, activities, goals: obj.goals ? cleanGoals(obj.goals) : null, settings: obj.settings ? cleanSettings(obj.settings) : null,
    rejected: (obj.history.length - sessions.length) + (obj.tasks.length - tasks.length) + (rawActs.length - activities.length) };
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

  const S = { settings: null, timer: null, history: [], tasks: [], activities: [], goals: {}, chat: [], audit: [], ids: new Set(), rev: 0, warnings, get writeFailed() { return writeFailed; } };

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
  const acts = readJSON(KEYS.activities), goals = readJSON(KEYS.goals), chat = readJSON(KEYS.chat), auditLog = readJSON(KEYS.audit);
  S.activities = dedupe((Array.isArray(acts) ? acts : []).map(cleanActivity).filter(Boolean), a => a.id);
  S.goals = cleanGoals(goals);
  S.chat = Array.isArray(chat) ? chat.filter(m => m && (m.role === 'user' || m.role === 'zyn') && typeof m.text === 'string').slice(-150) : [];
  S.audit = Array.isArray(auditLog) ? auditLog.slice(-300) : [];
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
  S.addTask = (title, pri = 2, est = 0) => {
    const t = cleanTask({ id: uid(), title, pri, est, created: Date.now() });
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

  /* ---------- activities (exercise, habits, study, reading, water …) ----------
     Every change is all-or-nothing: if the device refuses the write, memory is rolled back and { ok: false } is returned,
     so the app never reports a record as saved when it is not. */
  const audit = (op, ids, src, before, after) => {
    S.audit.push({ ts: Date.now(), op, ids, src, ...(before ? { before } : {}), ...(after ? { after } : {}) });
    if (S.audit.length > 300) S.audit = S.audit.slice(-300);
    writeJSON(KEYS.audit, S.audit);
  };
  const commitActs = (prev) => { if (writeJSON(KEYS.activities, S.activities)) { touch(); return true; } S.activities = prev; return false; };
  S.addActivities = (list, src = 'manual') => {
    const now = Date.now(), have = new Set(S.activities.map(a => a.id)), clean = [];
    for (const r of list) {
      const c = cleanActivity({ ...r, id: r.id || undefined, src, created: now, updated: now });
      if (!c || have.has(c.id)) return { ok: false, error: 'invalid', records: [] };
      have.add(c.id); clean.push(c);
    }
    if (!clean.length) return { ok: false, error: 'empty', records: [] };
    const prev = S.activities; S.activities = prev.concat(clean);
    if (!commitActs(prev)) return { ok: false, error: 'storage', records: [] };
    audit('add', clean.map(c => c.id), src, null, clean);
    return { ok: true, records: clean.map(c => ({ ...c })) };
  };
  S.updateActivity = (id, patch, src = 'manual') => {
    const i = S.activities.findIndex(a => a.id === id); if (i < 0) return { ok: false, error: 'missing' };
    const before = S.activities[i], next = cleanActivity({ ...before, ...patch, id, created: before.created, src: before.src, updated: Date.now() });
    if (!next) return { ok: false, error: 'invalid' };
    const prev = S.activities; S.activities = prev.slice(); S.activities[i] = next;
    if (!commitActs(prev)) return { ok: false, error: 'storage' };
    audit('update', [id], src, before, next);
    return { ok: true, record: { ...next }, before: { ...before } };
  };
  S.deleteActivities = (ids, src = 'manual') => {
    const set = new Set(ids), removed = S.activities.filter(a => set.has(a.id));
    if (!removed.length) return { ok: false, error: 'missing', records: [] };
    const prev = S.activities; S.activities = prev.filter(a => !set.has(a.id));
    if (!commitActs(prev)) return { ok: false, error: 'storage', records: [] };
    audit('delete', removed.map(a => a.id), src, removed, null);
    return { ok: true, records: removed };
  };
  S.restoreActivities = (records, src = 'manual') => {                 // undo of a delete: same ids come back
    const have = new Set(S.activities.map(a => a.id)), back = records.map(cleanActivity).filter(a => a && !have.has(a.id));
    if (!back.length) return { ok: false, error: 'empty', records: [] };
    const prev = S.activities; S.activities = prev.concat(back);
    if (!commitActs(prev)) return { ok: false, error: 'storage', records: [] };
    audit('restore', back.map(a => a.id), src, null, back);
    return { ok: true, records: back };
  };
  S.activity = id => { const a = S.activities.find(x => x.id === id); return a ? { ...a } : null; };
  // focus sessions logged by hand (e.g. "I completed 3 Pomodoro sessions"): real history entries, flagged manual, no XP
  S.addManualSessions = (n, minutes, day) => {
    const base = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), 12).getTime(), t = day === dkey(Date.now()) ? Date.now() : base;
    const added = [], key = uid();
    for (let i = 0; i < n; i++) { const e = { id: `man-${key}-${i}`, t: t - i * 1000, m: 'focus', s: Math.round(minutes * 60), c: 1, x: 0, man: 1 }; if (S.addSession(e)) added.push(e); }
    if (writeFailed) return { ok: false, error: 'storage', sessions: added };
    audit('sessions', added.map(e => e.id), 'chat', null, added);
    return { ok: true, sessions: added };
  };
  S.removeSessions = ids => { const set = new Set(ids), n = S.history.length; S.history = S.history.filter(h => !set.has(h.id)); ids.forEach(i => S.ids.delete(i)); if (S.history.length !== n) saveHistory(); return n - S.history.length; };

  /* daily goals: { name: { qty, unit } } */
  S.setGoal = (name, qty, unit) => {
    const next = cleanGoals({ ...S.goals, [name]: { qty, unit } });
    if (!next[name]) return { ok: false, error: 'invalid' };
    const prev = S.goals; S.goals = next;
    if (!writeJSON(KEYS.goals, S.goals)) { S.goals = prev; return { ok: false, error: 'storage' }; }
    touch(); return { ok: true, goal: next[name] };
  };
  S.removeGoal = name => { const prev = S.goals; S.goals = { ...prev }; delete S.goals[name]; if (!writeJSON(KEYS.goals, S.goals)) { S.goals = prev; return false; } touch(); return true; };

  /* chat history (kept on this device only) */
  S.saveChat = msgs => { S.chat = msgs.slice(-150); if (S.settings.chatSave) writeJSON(KEYS.chat, S.chat); else { try { storage.removeItem(KEYS.chat); } catch (e) {} } };
  S.clearChat = () => { S.chat = []; try { storage.removeItem(KEYS.chat); } catch (e) {} };

  /* backup / restore / reset */
  S.exportData = () => ({
    app: 'zentry', version: DATA_VERSION, exportedAt: new Date().toISOString(),
    settings: S.settings, history: S.history, tasks: S.tasks, activities: S.activities, goals: S.goals,
    summary: { sessions: S.history.length, tasks: S.tasks.length, activities: S.activities.length, totalXp: S.totalXp() }
  });
  S.importData = (parsed, how) => {
    if (how === 'replace') {
      try { storage.setItem('sl.prerestore', JSON.stringify(S.exportData())); } catch (e) {}   // safety copy of what is being replaced
      S.history = parsed.sessions.slice(); S.tasks = parsed.tasks.slice(); S.activities = (parsed.activities || []).slice();
      if (parsed.goals) { S.goals = parsed.goals; writeJSON(KEYS.goals, S.goals); }
      if (parsed.settings) { S.settings = parsed.settings; writeJSON(KEYS.settings, S.settings); }
      S.ids = new Set(S.history.map(h => h.id));
      saveHistory(); saveTasks(); writeJSON(KEYS.activities, S.activities);
      return { sessions: S.history.length, tasks: S.tasks.length, activities: S.activities.length };
    }
    let a = 0, b = 0, c = 0;
    for (const s of parsed.sessions) if (!S.ids.has(s.id)) { S.ids.add(s.id); S.history.push(s); a++; }
    const tids = new Set(S.tasks.map(t => t.id));
    for (const t of parsed.tasks) if (!tids.has(t.id)) { S.tasks.push(t); b++; }
    const aids = new Set(S.activities.map(x => x.id));
    for (const x of parsed.activities || []) if (!aids.has(x.id)) { S.activities.push(x); c++; }
    if (parsed.goals) for (const [k, v] of Object.entries(parsed.goals)) if (!S.goals[k]) S.goals[k] = v;
    if (a) saveHistory(); if (b) saveTasks(); if (c) { writeJSON(KEYS.activities, S.activities); touch(); } if (parsed.goals) writeJSON(KEYS.goals, S.goals);
    return { sessions: a, tasks: b, activities: c };
  };
  S.resetAll = () => {
    for (const k of [KEYS.settings, KEYS.timer, KEYS.history, KEYS.tasks, KEYS.activities, KEYS.goals, KEYS.chat, KEYS.audit]) { try { storage.removeItem(k); } catch (e) {} }
    S.settings = cleanSettings(null); S.timer = cleanTimer(null, S.settings); S.history = []; S.tasks = []; S.ids = new Set();
    S.activities = []; S.goals = {}; S.chat = []; S.audit = [];
    writeJSON(KEYS.settings, S.settings); writeJSON(KEYS.timer, S.timer); writeJSON(KEYS.history, S.history); writeJSON(KEYS.tasks, S.tasks);
    writeJSON(KEYS.meta, { migrated: true, v: DATA_VERSION });   // prevents old v1 data from being re-imported
    touch();
  };
  return S;
}
