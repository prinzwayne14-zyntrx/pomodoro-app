// Activity + focus analytics. Pure functions over persisted records — the only place statistics are computed.
//
// Definitions (all dates are LOCAL calendar days on this device, keys 'YYYY-MM-DD'):
//   today        = the current local calendar day
//   yesterday    = the previous local calendar day
//   this_week    = Monday of the current week .. today            (calendar week, Monday start)
//   last_week    = the previous Monday .. Sunday
//   this_month   = the 1st of the current month .. today
//   last_month   = the whole previous calendar month
//   last_7/30    = the last 7/30 days including today              (rolling)
//   all          = everything recorded
// An activity record counts for the day stored in its `day` field (the day it happened, not the day it was typed).
// Focus time counts every focused minute of a session (completed or interrupted ≥ 1 min); "sessions" counts completed focus sessions only.
import { dkey, dayNum } from './rpg.js';
import { labelOf, catOf } from './catalog.js';

const fromNum = n => { const d = new Date(Date.UTC(1970, 0, 1) + n * 864e5); return d.toISOString().slice(0, 10); };
export const RANGE_LABEL = { today: 'today', yesterday: 'yesterday', this_week: 'this week', last_week: 'last week', this_month: 'this month', last_month: 'last month', last_7: 'in the last 7 days', last_30: 'in the last 30 days', all: 'in total' };

/** Resolve a named range to inclusive day keys. */
export function resolveRange(range, now = Date.now()) {
  const t = dayNum(dkey(now)), dow = (t + 4) % 7, mon = t - ((dow + 6) % 7);
  const d = new Date(now), y = d.getFullYear(), m = d.getMonth();
  const k = (yy, mm, dd) => dkey(new Date(yy, mm, dd, 12).getTime());
  switch (range) {
    case 'yesterday': return { from: fromNum(t - 1), to: fromNum(t - 1) };
    case 'this_week': return { from: fromNum(mon), to: fromNum(t) };
    case 'last_week': return { from: fromNum(mon - 7), to: fromNum(mon - 1) };
    case 'this_month': return { from: k(y, m, 1), to: fromNum(t) };
    case 'last_month': return { from: k(y, m - 1, 1), to: k(y, m, 0) };
    case 'last_7': return { from: fromNum(t - 6), to: fromNum(t) };
    case 'last_30': return { from: fromNum(t - 29), to: fromNum(t) };
    case 'all': return { from: '0000-01-01', to: fromNum(t) };
    default: return { from: fromNum(t), to: fromNum(t) };
  }
}
export const inRange = (key, r) => key >= r.from && key <= r.to;
export const daysIn = r => r.from === '0000-01-01' ? null : dayNum(r.to) - dayNum(r.from) + 1;

/** Totals per activity+unit in a range. */
export function activityTotals(acts, r) {
  const map = new Map(), days = new Set(), exDays = new Set();
  let entries = 0;
  for (const a of acts) {
    if (!inRange(a.day, r)) continue;
    entries++; days.add(a.day); if (catOf(a.name) === 'exercise' || a.cat === 'exercise') exDays.add(a.day);
    const key = a.name + '|' + a.unit;
    let t = map.get(key); if (!t) map.set(key, t = { name: a.name, label: a.label || labelOf(a.name), cat: a.cat, unit: a.unit, qty: 0, count: 0, days: new Set() });
    t.qty = Math.round((t.qty + a.qty) * 100) / 100; t.count++; t.days.add(a.day);
  }
  const list = [...map.values()].map(t => ({ ...t, days: t.days.size })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { entries, activeDays: days.size, exerciseDays: exDays.size, list };
}
export function totalOf(acts, name, r) {
  const out = {};
  for (const a of acts) if (a.name === name && inRange(a.day, r)) out[a.unit] = Math.round(((out[a.unit] || 0) + a.qty) * 100) / 100;
  return out;                                                             // { reps: 40 } or { min: 60, km: 10 }
}

/** Focus history in a range. */
export function focusIn(history, r) {
  let sec = 0, done = 0, cut = 0, xp = 0, manual = 0, doneSec = 0; const days = new Set();
  for (const h of history) {
    if (h.m !== 'focus' || !inRange(dkey(h.t), r)) continue;
    sec += h.s; xp += h.x; if (h.c) { done++; doneSec += h.s; days.add(dkey(h.t)); if (h.man) manual++; } else cut++;
  }
  return { sec, done, cut, xp, manual, days: days.size, avgSec: done ? Math.round(doneSec / done) : 0 };   // average length of a completed session
}

/** Per-day series for the last n days: focus seconds, completed sessions, activity entries. */
export function series(history, acts, n, now = Date.now()) {
  const t = dayNum(dkey(now)), out = [];
  const idx = new Map();
  for (let i = n - 1; i >= 0; i--) { const k = fromNum(t - i); idx.set(k, out.length); out.push({ k, sec: 0, done: 0, acts: 0 }); }
  for (const h of history) if (h.m === 'focus') { const i = idx.get(dkey(h.t)); if (i != null) { out[i].sec += h.s; if (h.c) out[i].done++; } }
  for (const a of acts) { const i = idx.get(a.day); if (i != null) out[i].acts++; }
  return out;
}

/** Daily goals for one day. goals: { name: { qty, unit } } */
export function goalProgress(acts, goals, day) {
  return Object.entries(goals || {}).map(([name, g]) => {
    let done = 0; for (const a of acts) if (a.name === name && a.unit === g.unit && a.day === day) done += a.qty;
    done = Math.round(done * 100) / 100;
    return { name, label: labelOf(name), unit: g.unit, target: g.qty, done, pct: Math.min(1, done / g.qty), met: done >= g.qty };
  });
}
/** Habit completion rate: share of days in the range on which each goal was met. Days before the goal existed still count — the rate is honest about the whole window. */
export function habitRates(acts, goals, history, focusGoal, r) {
  const n = daysIn(r) || 0, out = [];
  const keys = []; for (let d = dayNum(r.from); d <= dayNum(r.to); d++) keys.push(fromNum(d));
  for (const [name, g] of Object.entries(goals || {})) {
    const per = new Map(); for (const a of acts) if (a.name === name && a.unit === g.unit && inRange(a.day, r)) per.set(a.day, (per.get(a.day) || 0) + a.qty);
    const met = keys.filter(k => (per.get(k) || 0) >= g.qty).length;
    out.push({ name, label: labelOf(name), unit: g.unit, target: g.qty, met, days: n, rate: n ? met / n : 0 });
  }
  if (focusGoal) {
    const per = new Map(); for (const h of history) if (h.m === 'focus' && h.c) { const k = dkey(h.t); if (inRange(k, r)) per.set(k, (per.get(k) || 0) + 1); }
    const met = keys.filter(k => (per.get(k) || 0) >= focusGoal).length;
    out.unshift({ name: 'focus', label: 'Focus sessions', unit: 'sessions', target: focusGoal, met, days: n, rate: n ? met / n : 0 });
  }
  return out;
}
/** Activity streak: consecutive days (ending today, or yesterday if today has nothing yet) with at least one record of a category / name. */
export function activityStreak(acts, now = Date.now(), filter = () => true) {
  const set = new Set(acts.filter(filter).map(a => dayNum(a.day)));
  let cur = dayNum(dkey(now)), n = 0; if (!set.has(cur)) cur--;
  while (set.has(cur)) { n++; cur--; }
  return n;
}
