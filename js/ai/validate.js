// The gate between language understanding (rules or an AI model) and the database.
// 1. sanitize(): coerce any engine output (possibly malformed LLM JSON) into a well-formed Interpretation.
// 2. validateItems(): turn items into candidate records, or questions for the user. Never invents data.
import { resolveActivity, unitOf, fitUnit, LIMITS, HARD_MAX, labelOf, cap } from '../catalog.js';
import { findDate, numbersIn } from './nlu.js';
import { dkey, dayNum } from '../rpg.js';

export const INTENTS = ['log', 'correct', 'delete', 'query', 'timer', 'goal', 'greet', 'thanks', 'help', 'unknown'];
export const METRICS = ['activity', 'focus_time', 'focus_sessions', 'exercise_days', 'summary', 'progress', 'advice', 'streak', 'goals', 'level', 'evolution', 'tasks'];
export const RANGES = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_7', 'last_30', 'all'];
const str = (v, n) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null;
const num = v => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };

/** Coerce engine output into a valid Interpretation. Unknown fields are dropped; bad values become null. */
export function sanitize(o, now = Date.now()) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not an object');
  const intent = INTENTS.includes(o.intent) ? o.intent : 'unknown';
  const date = d => { if (d == null) return { key: null }; const s = String(d).toLowerCase().trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayNum(s) > dayNum(dkey(now)) ? { key: s, future: true } : { key: s }; const f = findDate(s, now); return f ? { key: f.key, future: !!f.future } : { key: null }; };
  const items = (Array.isArray(o.items) ? o.items : Array.isArray(o.activities) ? o.activities : []).slice(0, 10).filter(x => x && typeof x === 'object').map(x => {
    const d = date(x.date ?? x.occurred_at ?? null);
    const it = { activity: str(x.activity ?? x.name, 60), quantity: num(x.quantity), unit: str(x.unit, 20), date: d.key };
    if (d.future) it.future = true;
    if (x.custom === true) it.custom = true;
    if (x.ambiguous === 'sessions' || /^(sessions?|completed sessions?)$/i.test(it.activity || '')) { it.ambiguous = 'sessions'; it.activity = null; }
    return it;
  });
  const q = o.query && typeof o.query === 'object' ? o.query : null;
  const t = o.timer && typeof o.timer === 'object' ? o.timer : null;
  const g = o.goal && typeof o.goal === 'object' ? o.goal : null;
  const minutes = t ? num(t.minutes) : null;
  return {
    v: 1, intent, items,
    query: q ? { metric: METRICS.includes(q.metric) ? q.metric : 'summary', activity: str(q.activity, 60), range: RANGES.includes(q.range) ? q.range : null } : null,
    timer: t ? { action: ['start', 'pause', 'resume', 'reset', 'skip'].includes(t.action) ? t.action : 'start', mode: ['focus', 'short', 'long'].includes(t.mode) ? t.mode : 'focus', minutes: minutes && minutes >= 1 && minutes <= 180 ? Math.round(minutes) : null } : null,
    goal: g ? { target: str(g.target, 60), quantity: num(g.quantity), unit: str(g.unit, 20) } : null,
    target: o.target === 'all' ? 'all' : 'last'
  };
}

const ASK = {
  reps: a => `How many ${a.label.toLowerCase()} did you complete?`,
  plank: () => 'How long did you hold the plank? (e.g. 45 seconds)',
  reading: () => 'How many pages did you read — or for how many minutes?',
  water: () => 'How much water did you drink? (e.g. 500 ml or 1.5 L)',
  running: () => 'How long did you run (minutes) — or how far (km)?',
  walking: () => 'How long did you walk — or how many steps / km?',
  cycling: () => 'How long did you ride (minutes) — or how far (km)?',
  swimming: () => 'How long did you swim (minutes)?',
  time: a => `For how long? (e.g. 30 minutes of ${a.label.toLowerCase()})`
};
export function askQuantity(a) {
  if (!a) return 'How much was that?';
  return (ASK[a.name] || (a.bare === 'reps' ? ASK.reps : ASK.time))(a);
}

/**
 * Validate parsed items.
 * opts: { now, text, grounded }  grounded=true -> every quantity must appear in the user's text (stops AI hallucination)
 * returns { records: [candidate], issues: [{ kind, question, options?, item, record? }] }
 */
export function validateItems(items, opts = {}) {
  const now = opts.now || Date.now(), today = dkey(now), records = [], issues = [];
  const said = opts.grounded && opts.text != null ? numbersIn(opts.text) : null;
  for (const raw of items || []) {
    const it = { ...raw };
    if (it.ambiguous === 'sessions') { issues.push({ kind: 'ambiguous', item: it, question: `When you say ${it.quantity || ''} sessions, do you mean Pomodoro focus sessions — or something else?`.replace('  ', ' '), options: ['Pomodoro sessions', 'Something else'] }); continue; }
    const act = resolveActivity(it.activity);
    let name, label, cat, custom = false;
    if (act) ({ name, label, cat } = act);
    else {
      const n = String(it.activity || '').toLowerCase().replace(/[^a-z0-9 '-]/g, '').replace(/\s+/g, ' ').trim();
      if (n.length < 2 || n.length > 40) { issues.push({ kind: 'unknown', item: it, question: 'Which activity was that?' }); continue; }
      name = n; label = cap(n); cat = 'custom'; custom = true;
    }
    if (it.future) { issues.push({ kind: 'future', item: it, question: `I can only record things that already happened — that date (${it.date}) is in the future. When did you do it?` }); continue; }
    let day = today;
    if (it.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date) || isNaN(dayNum(it.date))) { issues.push({ kind: 'date', item: it, question: 'Which day was that?' }); continue; }
      if (dayNum(it.date) > dayNum(today)) { issues.push({ kind: 'future', item: it, question: 'That date is in the future. When did you do it?' }); continue; }
      if (dayNum(today) - dayNum(it.date) > 400) { issues.push({ kind: 'date', item: it, question: 'That date is more than a year ago — which day did you mean?' }); continue; }
      day = it.date;
    }
    let qty = it.quantity;
    if (qty != null && said && !said.has(qty) && !said.has(Math.round(qty * 1000) / 1000)) qty = null;   // the model invented a number
    if (qty == null) { issues.push({ kind: 'quantity', item: { ...it, activity: name, custom }, question: act ? askQuantity(act) : `How many ${label.toLowerCase()} — or for how long?` }); continue; }
    if (!(qty > 0) || !Number.isFinite(qty)) { issues.push({ kind: 'invalid', item: it, question: `That amount doesn't look right. How much ${label.toLowerCase()} was it?` }); continue; }

    let unit = null, factor = 1;
    if (it.unit) {
      const u = unitOf(it.unit);
      if (!u) { issues.push({ kind: 'unit', item: { ...it, activity: name }, question: `I don't know the unit “${it.unit}”. ${act ? askQuantity(act) : 'Could you say it in minutes or as a count?'}` }); continue; }
      if (u.unit === 'vessel') { issues.push({ kind: 'unit', item: { ...it, activity: name, quantity: null, unit: null }, question: `How much was that in total? (e.g. ${qty === 1 ? '250' : qty * 250} ml) — I won't guess the size of a ${it.unit.replace(/e?s$/, '')}.` }); continue; }
      unit = u.unit; factor = u.factor;
    } else if (act && act.bare) unit = act.bare;
    else if (custom) unit = 'times';
    else { issues.push({ kind: 'unit', item: { ...it, activity: name }, question: act.units.length > 1 ? `${qty} what — ${act.units.map(u => u === 'min' ? 'minutes' : u).join(' or ')}?` : askQuantity(act) }); continue; }
    if (custom && unit === 'reps') unit = 'times';
    let q2 = qty * factor;
    if (act) {
      const f = fitUnit(act, q2, unit);
      if (!f) { issues.push({ kind: 'unit', item: { ...it, activity: name, quantity: null }, question: `${label} is tracked in ${act.units.map(u => u === 'sec' ? 'seconds' : u === 'min' ? 'minutes' : u).join(' or ')}. ${askQuantity(act)}` }); continue; }
      ({ qty: q2, unit } = f);
    }
    if (['reps', 'times', 'steps', 'sessions'].includes(unit) && Math.abs(q2 - Math.round(q2)) > 1e-9) { issues.push({ kind: 'invalid', item: it, question: `${label} is counted in whole numbers — how many exactly?` }); continue; }
    q2 = Math.round(q2 * 100) / 100;
    if (q2 > HARD_MAX[unit]) { issues.push({ kind: 'invalid', item: it, question: `${q2} ${unit} is more than I can record in one entry. Could you check the amount?` }); continue; }
    const rec = { name, label, cat, qty: q2, unit, day, at: day === today ? now : new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), 12).getTime() };
    if (it.note) rec.note = String(it.note).slice(0, 80);
    if (custom) rec.custom = true;
    if (q2 > LIMITS[unit]) { issues.push({ kind: 'large', record: rec, item: it, question: `That's ${q2.toLocaleString('en-US')} ${unit === 'reps' ? labelOf(name).toLowerCase() : unit} in one entry — is that right?`, options: ['Yes, save it', 'No'] }); continue; }
    records.push(rec);
  }
  return { records, issues };
}
