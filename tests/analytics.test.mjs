// Statistics are computed from persisted records only. Run under several time zones by `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRange, activityTotals, totalOf, focusIn, series, goalProgress, habitRates, activityStreak } from '../js/analytics.js';
import { stats, dkey } from '../js/rpg.js';
import { createStore } from '../js/store.js';

const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 31, 15);                                   // Saturday 31 Oct 2026, local time
const A = (name, qty, unit, day, extra = {}) => ({ id: 'x' + Math.random().toString(36).slice(2, 9), name, qty, unit, day, cat: name === 'study' ? 'study' : 'exercise', ...extra });

test('ranges: calendar week starts Monday, months are calendar months, rolling windows include today', () => {
  assert.deepEqual(resolveRange('today', NOW), { from: '2026-10-31', to: '2026-10-31' });
  assert.deepEqual(resolveRange('yesterday', NOW), { from: '2026-10-30', to: '2026-10-30' });
  assert.deepEqual(resolveRange('this_week', NOW), { from: '2026-10-26', to: '2026-10-31' });
  assert.deepEqual(resolveRange('last_week', NOW), { from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(resolveRange('this_month', NOW), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(resolveRange('last_month', NOW), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(resolveRange('last_7', NOW), { from: '2026-10-25', to: '2026-10-31' });
  // Monday itself, and a Sunday (week must not start on Sunday)
  assert.deepEqual(resolveRange('this_week', at(2026, 10, 26, 0, 5)), { from: '2026-10-26', to: '2026-10-26' });
  assert.deepEqual(resolveRange('this_week', at(2026, 11, 1, 23, 50)), { from: '2026-10-26', to: '2026-11-01' });
  // year boundary
  assert.deepEqual(resolveRange('last_month', at(2027, 1, 3)), { from: '2026-12-01', to: '2026-12-31' });
});
test('day boundaries follow local time: 23:59 and 00:01 land on different days', () => {
  assert.equal(dkey(at(2026, 10, 30, 23, 59)), '2026-10-30');
  assert.equal(dkey(at(2026, 10, 31, 0, 1)), '2026-10-31');
  const h = [{ id: 'a', t: at(2026, 10, 30, 23, 59), m: 'focus', s: 1500, c: 1, x: 35 }, { id: 'b', t: at(2026, 10, 31, 0, 1), m: 'focus', s: 1500, c: 1, x: 35 }];
  assert.equal(focusIn(h, resolveRange('today', NOW)).done, 1); assert.equal(focusIn(h, resolveRange('yesterday', NOW)).done, 1);
});
test('daylight-saving change does not shift days (US DST ends Nov 1 2026, EU Oct 25 2026)', () => {
  const after = at(2026, 11, 2, 9);
  assert.deepEqual(resolveRange('last_7', after), { from: '2026-10-27', to: '2026-11-02' });
  assert.deepEqual(resolveRange('yesterday', after), { from: '2026-11-01', to: '2026-11-01' });
  assert.equal(series([], [], 10, after).map(d => d.k).join(','), '2026-10-24,2026-10-25,2026-10-26,2026-10-27,2026-10-28,2026-10-29,2026-10-30,2026-10-31,2026-11-01,2026-11-02');
});
test('activity totals per day / week / month from known sample data', () => {
  const acts = [A('push-ups', 10, 'reps', '2026-10-31'), A('push-ups', 15, 'reps', '2026-10-30'), A('push-ups', 99, 'reps', '2026-10-25'),
    A('push-ups', 7, 'reps', '2026-09-30'), A('study', 120, 'min', '2026-10-31'), A('running', 30, 'min', '2026-10-28'), A('running', 5, 'km', '2026-10-28')];
  assert.deepEqual(totalOf(acts, 'push-ups', resolveRange('today', NOW)), { reps: 10 });
  assert.deepEqual(totalOf(acts, 'push-ups', resolveRange('this_week', NOW)), { reps: 25 });
  assert.deepEqual(totalOf(acts, 'push-ups', resolveRange('this_month', NOW)), { reps: 124 });
  assert.deepEqual(totalOf(acts, 'push-ups', resolveRange('all', NOW)), { reps: 131 });
  assert.deepEqual(totalOf(acts, 'running', resolveRange('this_week', NOW)), { min: 30, km: 5 });   // units are never mixed
  const t = activityTotals(acts, resolveRange('this_week', NOW));
  assert.equal(t.entries, 5); assert.equal(t.activeDays, 3); assert.equal(t.exerciseDays, 3);
  assert.equal(activityTotals(acts, resolveRange('today', NOW)).exerciseDays, 1);
});
test('edited and deleted activities are reflected immediately (stats read the store, no stored counters)', () => {
  const m = new Map(), st = createStore({ getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) });
  const r = st.addActivities([{ name: 'push-ups', qty: 10, unit: 'reps', day: dkey(Date.now()) }, { name: 'squats', qty: 20, unit: 'reps', day: dkey(Date.now()) }]);
  const today = resolveRange('today');
  assert.deepEqual(totalOf(st.activities, 'push-ups', today), { reps: 10 });
  st.updateActivity(r.records[0].id, { qty: 8 }); assert.deepEqual(totalOf(st.activities, 'push-ups', today), { reps: 8 });
  st.deleteActivities([r.records[0].id]); assert.deepEqual(totalOf(st.activities, 'push-ups', today), {});
  assert.equal(activityTotals(st.activities, today).entries, 1);
  assert.deepEqual(st.audit.map(a => a.op), ['add', 'update', 'delete']);
  // reload from storage: same numbers
  const st2 = createStore({ getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) });
  assert.equal(st2.activities.length, 1); assert.equal(st2.activities[0].name, 'squats');
});
test('duplicate ids and invalid records never reach statistics', () => {
  const m = new Map(), good = { id: 'dup-1', name: 'squats', qty: 5, unit: 'reps', day: '2026-10-31' };
  m.set('sl.activities', JSON.stringify([good, good, { ...good, id: 'bad', qty: -4 }, { ...good, id: 'bad2', unit: 'parsecs' }, { ...good, id: 'bad3', day: '2026-02-31' }, null, 'x']));
  const st = createStore({ getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) });
  assert.equal(st.activities.length, 1);
  assert.equal(st.addActivities([{ ...good }]).ok, false);                                  // same id again is refused
});
test('focus: completed vs interrupted, average session, manual sessions earn no XP', () => {
  const h = [{ id: '1', t: at(2026, 10, 31, 9), m: 'focus', s: 1500, c: 1, x: 35 }, { id: '2', t: at(2026, 10, 31, 10), m: 'focus', s: 3000, c: 1, x: 60 },
    { id: '3', t: at(2026, 10, 31, 11), m: 'focus', s: 300, c: 0, x: 0 }, { id: '4', t: at(2026, 10, 31, 12), m: 'focus', s: 1500, c: 1, x: 0, man: 1 }];
  const f = focusIn(h, resolveRange('today', NOW));
  assert.equal(f.done, 3); assert.equal(f.cut, 1); assert.equal(f.sec, 6300); assert.equal(f.avgSec, 2000); assert.equal(f.manual, 1); assert.equal(f.xp, 95);
});
test('streaks: focus streak needs XP-earning sessions; activity streak counts days with records', () => {
  const day = d => at(2026, 10, d, 10), h = [29, 30, 31].map(d => ({ id: 'd' + d, t: day(d), m: 'focus', s: 1500, c: 1, x: 35 }));
  assert.equal(stats(h, [], NOW).streak, 3);
  assert.equal(stats(h.slice(0, 2), [], NOW).streak, 2);                     // today not done yet: streak still alive
  assert.equal(stats([h[0]], [], NOW).streak, 0);                             // gap yesterday: broken
  const acts = [A('squats', 5, 'reps', '2026-10-31'), A('squats', 5, 'reps', '2026-10-30'), A('squats', 5, 'reps', '2026-10-28')];
  assert.equal(activityStreak(acts, NOW), 2);
});
test('goals and habit completion rates', () => {
  const acts = [A('push-ups', 30, 'reps', '2026-10-31'), A('push-ups', 25, 'reps', '2026-10-31'), A('push-ups', 50, 'reps', '2026-10-29'), A('push-ups', 40, 'reps', '2026-10-28')];
  const goals = { 'push-ups': { qty: 50, unit: 'reps' } };
  assert.deepEqual(goalProgress(acts, goals, '2026-10-31').map(g => [g.done, g.met]), [[55, true]]);
  const r = habitRates(acts, goals, [], 2, resolveRange('last_7', NOW));
  assert.equal(r[1].met, 2); assert.equal(r[1].days, 7); assert.equal(r[0].label, 'Focus sessions'); assert.equal(r[0].met, 0);
});
test('empty data: zeros everywhere, never NaN', () => {
  const t = activityTotals([], resolveRange('all', NOW)), f = focusIn([], resolveRange('all', NOW));
  assert.deepEqual([t.entries, t.activeDays, f.sec, f.done, f.avgSec], [0, 0, 0, 0, 0]);
  assert.ok(series([], [], 7, NOW).every(d => d.sec === 0 && d.acts === 0));
  assert.deepEqual(habitRates([], {}, [], 0, resolveRange('last_7', NOW)), []);
});
