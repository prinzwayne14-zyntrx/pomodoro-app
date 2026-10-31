import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { xpFor, levelOf, rankOf, levelInfo, T, stats, dkey, agoKey } from '../js/rpg.js';
import * as TM from '../js/timer.js';
import { createStore, parseBackup, cleanSettings, cleanSession, cleanTask, DEFAULT_SETTINGS } from '../js/store.js';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
const S = { ...DEFAULT_SETTINGS };
const NOW = new Date(2026, 9, 31, 15, 0, 0).getTime();
const DAY = 864e5;

/* ---------- XP ---------- */
test('XP: only completed focus sessions of >= 10 min earn XP', () => {
  assert.equal(xpFor('focus', 1500, true), 25 + 10);
  assert.equal(xpFor('focus', 600, true), 10);          // exactly 10 min, no bonus
  assert.equal(xpFor('focus', 1200, true), 20 + 10);    // 20 min gets the bonus
  assert.equal(xpFor('focus', 599, true), 0);           // too short
  assert.equal(xpFor('focus', 60, true), 0);            // 1-minute farming earns nothing
  assert.equal(xpFor('focus', 1500, false), 0);         // interrupted
  assert.equal(xpFor('short', 1500, true), 0);          // breaks
  assert.equal(xpFor('focus', 99999, true), 180 + 10);  // capped
});
test('XP: farming with 1-minute sessions is impossible', () => {
  const t = TM.start(TM.newTimer({ ...S, focus: 1 }), 1000);
  assert.equal(TM.completedEntry({ ...t, endAt: 61000 }).x, 0);
});
test('levels and ranks', () => {
  assert.equal(T(2), 100); assert.equal(T(3), 300);
  assert.equal(levelOf(0), 1); assert.equal(levelOf(99), 1); assert.equal(levelOf(100), 2);
  assert.equal(levelOf(299), 2); assert.equal(levelOf(300), 3);
  for (let l = 1; l < 60; l++) { assert.equal(levelOf(T(l)), l); assert.equal(levelOf(T(l + 1) - 1), l); }
  assert.deepEqual([1, 4, 5, 9, 10, 14, 15, 24, 25, 39, 40].map(rankOf), ['E', 'E', 'D', 'D', 'C', 'C', 'B', 'B', 'A', 'A', 'S']);
  const i = levelInfo(360); assert.equal(i.level, 3); assert.equal(i.into, 60); assert.equal(i.need, 300); assert.equal(i.toNext, 240);
});

/* ---------- timer ---------- */
test('timer is timestamp based and survives pause/resume', () => {
  let t = TM.newTimer(S);
  t = TM.start(t, 1000);
  assert.equal(TM.remaining(t, 1000 + 60000), 25 * 60000 - 60000);
  t = TM.pause(t, 1000 + 60000);
  assert.equal(TM.remaining(t, 9e9), 24 * 60000);       // paused: does not drift
  t = TM.start(t, 5e6);
  assert.equal(t.endAt, 5e6 + 24 * 60000);
  assert.ok(!TM.expired(t, t.endAt - 1)); assert.ok(TM.expired(t, t.endAt));
  assert.equal(t.sid, '1000-focus');                    // same session id across pause/resume
});
test('abandoned sessions: logged only if >= 1 min, never earn XP', () => {
  let t = TM.start(TM.newTimer(S), 0);
  assert.equal(TM.abandonedEntry(t, 59000), null);
  const e = TM.abandonedEntry(t, 600000);
  assert.equal(e.c, 0); assert.equal(e.x, 0); assert.equal(e.s, 600);
});
test('break sessions are not recorded; cycle advances to long break', () => {
  assert.equal(TM.completedEntry(TM.start(TM.newTimer(S, 'short'), 0)), null);
  let t = { ...TM.newTimer(S), completed: 3 };
  assert.deepEqual(TM.nextAfterComplete(t, S), { mode: 'long', completed: 0 });
  assert.deepEqual(TM.nextAfterComplete({ ...t, completed: 0 }, S), { mode: 'short', completed: 1 });
  assert.deepEqual(TM.nextAfterComplete({ ...t, mode: 'short', completed: 2 }, S), { mode: 'focus', completed: 2 });
});

/* ---------- store ---------- */
test('duplicate session ids are rejected (no double XP)', () => {
  const st = createStore(mem());
  const e = { id: 'a', t: NOW, m: 'focus', s: 1500, c: 1, x: 35 };
  assert.equal(st.addSession(e), true); assert.equal(st.addSession(e), false);
  assert.equal(st.history.length, 1); assert.equal(st.totalXp(), 35);
  const again = createStore(st.history && mem({ 'sl.history': JSON.stringify(st.history) }));
  assert.equal(again.addSession(e), false);              // dedupe also holds after reload
});
test('data persists across reloads', () => {
  const m = mem(); let st = createStore(m);
  st.addSession({ id: 'a', t: NOW, m: 'focus', s: 1500, c: 1, x: 35 });
  st.addTask('Write report', 1); st.setSettings({ focus: 30, accent: 'violet' });
  st.saveTimer(TM.start(TM.newTimer(st.settings), NOW));
  st = createStore(m);
  assert.equal(st.history.length, 1); assert.equal(st.tasks[0].title, 'Write report');
  assert.equal(st.settings.focus, 30); assert.equal(st.settings.accent, 'violet'); assert.ok(st.timer.running);
});
test('corrupted data: kept aside, app starts clean, nothing thrown', () => {
  const st = createStore(mem({ 'sl.history': '{not json', 'sl.settings': '"x"', 'sl.tasks': '[1,null,{"title":""}]' }));
  assert.deepEqual(st.history, []); assert.deepEqual(st.tasks, []);
  assert.equal(st.settings.focus, 25);
  assert.ok(st.warnings.includes('sl.history'));
});
test('validation clamps and rejects bad values', () => {
  assert.equal(cleanSettings({ focus: 9999, short: -4, rounds: 'x', volume: 500, accent: 'neon' }).focus, 180);
  assert.equal(cleanSettings({ short: -4 }).short, 1);
  assert.equal(cleanSettings({ rounds: 'x' }).rounds, 4);
  assert.equal(cleanSettings({ volume: 500 }).volume, 100);
  assert.equal(cleanSettings({ accent: 'neon' }).accent, 'blue');
  assert.equal(cleanSession({ t: -1, m: 'focus', s: 5 }), null);
  assert.equal(cleanSession({ t: 5, m: 'bogus', s: 5 }), null);
  assert.equal(cleanSession({ t: 5, m: 'focus', s: 999999 }), null);
  assert.equal(cleanTask({ title: '   ' }), null);
  assert.equal(cleanTask({ title: 'x'.repeat(500) }).title.length, 120);
});
test('migrates v1 data without touching the old keys', () => {
  const old = { settings: { focus: 30 }, mode: 'focus', running: false, remaining: 1800000, completed: 2 };
  const hist = [{ t: NOW - DAY, m: 'focus', s: 1500, c: 1 }, { t: NOW - 2 * DAY, m: 'focus', s: 120, c: 0 }];
  const m = mem({ 'sololeveling.state.v1': JSON.stringify(old), 'sololeveling.history.v1': JSON.stringify(hist) });
  const st = createStore(m);
  assert.equal(st.settings.focus, 30); assert.equal(st.history.length, 2); assert.equal(st.timer.completed, 2);
  assert.equal(st.history[0].x, 35); assert.equal(st.history[1].x, 0);   // XP recomputed by the new, strict rules
  assert.ok(m.getItem('sololeveling.history.v1'));                       // old data left in place
  assert.equal(createStore(m).history.length, 2);                        // second load does not duplicate
});
test('tasks: create, edit, complete, delete, session counter', () => {
  const st = createStore(mem());
  const t = st.addTask('  Read chapter  ', 3); assert.equal(t.title, 'Read chapter'); assert.equal(t.pri, 3);
  st.updateTask(t.id, { title: 'Read chapter 2', pri: 1 });
  assert.equal(st.tasks[0].title, 'Read chapter 2'); assert.equal(st.tasks[0].pri, 1);
  assert.equal(st.addTask('   '), null);
  st.bumpTask(t.id); st.bumpTask(t.id); assert.equal(st.tasks[0].n, 2);
  st.setTaskDone(t.id, true); assert.ok(st.tasks[0].done && st.tasks[0].doneAt);
  st.setTaskDone(t.id, false); assert.equal(st.tasks[0].doneAt, null);
  assert.equal(st.deleteTask(t.id), true); assert.equal(st.tasks.length, 0);
});
test('backup export/import round trip, merge without duplicates, replace keeps a safety copy', () => {
  const a = createStore(mem());
  a.addSession({ id: 's1', t: NOW, m: 'focus', s: 1500, c: 1, x: 35 }); a.addSession({ id: 's2', t: NOW - DAY, m: 'focus', s: 1500, c: 1, x: 35 });
  a.addTask('One', 1); a.setSettings({ focus: 40 });
  const json = JSON.parse(JSON.stringify(a.exportData()));
  const p = parseBackup(json); assert.equal(p.sessions.length, 2); assert.equal(p.tasks.length, 1); assert.equal(p.rejected, 0);

  const bm = mem(); const b = createStore(bm);
  b.addSession({ id: 's1', t: NOW, m: 'focus', s: 1500, c: 1, x: 35 });          // already has s1
  assert.deepEqual(b.importData(p, 'merge'), { sessions: 1, tasks: 1 });
  assert.deepEqual(b.importData(p, 'merge'), { sessions: 0, tasks: 0 });          // idempotent
  assert.equal(b.history.length, 2); assert.equal(b.totalXp(), 70);

  b.addSession({ id: 'extra', t: NOW, m: 'focus', s: 1500, c: 1, x: 35 });
  b.importData(p, 'replace');
  assert.equal(b.history.length, 2);
  assert.ok(JSON.parse(bm.getItem('sl.prerestore')).history.some(h => h.id === 'extra'));   // nothing silently lost
  assert.equal(json.app, 'zyntry');
  assert.equal(parseBackup({ ...json, app: 'solo-leveling' }).sessions.length, 2);   // backups from the old app name still import
  assert.throws(() => parseBackup({ app: 'other' }));
  assert.throws(() => parseBackup({ app: 'solo-leveling', version: 99, history: [], tasks: [] }));
  assert.throws(() => parseBackup(null));
});
test('reset wipes data and does not resurrect legacy data', () => {
  const m = mem({ 'sololeveling.history.v1': JSON.stringify([{ t: NOW, m: 'focus', s: 1500, c: 1 }]) });
  const st = createStore(m); assert.equal(st.history.length, 1);
  st.resetAll(); assert.equal(st.history.length, 0);
  assert.equal(createStore(m).history.length, 0);
});
test('write failures are reported, not thrown', () => {
  const m = mem(); m.setItem = () => { throw new Error('quota'); };
  const st = createStore(m); st.addSession({ id: 'q', t: NOW, m: 'focus', s: 1500, c: 1, x: 35 });
  assert.equal(st.writeFailed, true);
});

/* ---------- statistics ---------- */
test('stats are computed from recorded sessions', () => {
  const day = n => NOW - n * DAY;
  const h = [
    { id: '1', t: day(0), m: 'focus', s: 1500, c: 1, x: 35 },
    { id: '2', t: day(0) - 3600e3, m: 'focus', s: 600, c: 0, x: 0 },
    { id: '3', t: day(1), m: 'focus', s: 1500, c: 1, x: 35 },
    { id: '4', t: day(2), m: 'focus', s: 1500, c: 1, x: 35 },
    { id: '5', t: day(4), m: 'focus', s: 1500, c: 1, x: 35 },      // gap -> streak 3, best 3
    { id: '6', t: day(5), m: 'focus', s: 300, c: 1, x: 0 },        // < 10 min: counts as session, not for streak
    { id: '7', t: day(40), m: 'focus', s: 1500, c: 1, x: 35 },
  ];
  const tasks = [{ done: true, doneAt: NOW - 1000 }, { done: true, doneAt: NOW - 3 * DAY }, { done: false }];
  const s = stats(h, tasks, NOW);
  assert.equal(s.todaySec, 2100); assert.equal(s.todayN, 1); assert.equal(s.todayXp, 35);
  assert.equal(s.done, 6); assert.equal(s.cut, 1); assert.equal(s.rate, 86);
  assert.equal(s.streak, 3); assert.equal(s.best, 3);
  assert.equal(s.weekSec, 2100 + 1500 * 3 + 300); assert.equal(s.totalSec, 8400);
  assert.equal(s.totalXp, 175);
  assert.equal(s.week.length, 7); assert.equal(s.heat.length, 28);
  assert.equal(s.tasksDoneToday, 1); assert.equal(s.tasksDoneTotal, 2);
  assert.equal(stats(h, tasks, NOW, 120).todaySec, 2220);          // live (in-progress) seconds are added on top
});
test('stats: empty history gives zeros, not NaN', () => {
  const s = stats([], [], NOW);
  assert.equal(s.todaySec, 0); assert.equal(s.rate, null); assert.equal(s.streak, 0); assert.equal(s.avg7, 0);
});
test('streak does not break before today ends', () => {
  const h = [{ id: 'a', t: NOW - DAY, m: 'focus', s: 1500, c: 1, x: 35 }, { id: 'b', t: NOW - 2 * DAY, m: 'focus', s: 1500, c: 1, x: 35 }];
  assert.equal(stats(h, [], NOW).streak, 2);
});
test('app and service-worker versions match', () => {
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8').match(/VERSION = '([^']+)'/)[1];
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
  assert.equal(sw, app);
});
