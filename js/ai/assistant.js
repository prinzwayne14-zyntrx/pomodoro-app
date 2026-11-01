// Zyn, the ZENTRY assistant. Orchestrates: message -> engine -> sanitize -> validate -> (clarify | confirm | save) -> reply from saved data.
//
// Safety rules enforced here:
//  • An engine's output is only a proposal. Records are built by validate.js and written by the store, which can refuse.
//  • A reply never says "recorded" unless the store returned ok and the reply is built from the returned records.
//  • Missing amounts are asked for, never guessed. Unknown activities, very large amounts, manual focus sessions,
//    deletions and ambiguous corrections all need an explicit confirmation.
//  • Read-only questions are answered from analytics over persisted records; suggestions are labelled as suggestions.
import { parse, normalize, findDate, quantities } from './nlu.js';
import { sanitize, validateItems, askQuantity } from './validate.js';
import { activity as catalogActivity, resolveActivity, describe, fmtQty, labelOf, unitOf, fitUnit, cap } from '../catalog.js';
import { resolveRange, RANGE_LABEL, totalOf, focusIn, activityTotals, series, goalProgress, habitRates } from '../analytics.js';
import { stats, levelInfo, rankInfo, discipline, dkey, dayNum, dayparts, DAYPARTS } from '../rpg.js';

const fmtDur = sec => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`; };
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|correct|right|do it|save( it)?|confirm|please do|go ahead|y)\b/i;
const NO = /^(no|nope|nah|cancel|don'?t|stop|never ?mind|n)\b/i;
const dayPhrase = (day, now) => {
  const d = dayNum(dkey(now)) - dayNum(day);
  if (d === 0) return 'for today';
  const label = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), 12).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return d === 1 ? `for yesterday (${label})` : `for ${label}`;
};
const PRAISE = ['Great work.', 'Nice!', 'Strong.', 'That’s how it’s done.', 'Good job.', 'Love it.'];

export function createAssistant({ store, engines, timer, now = () => Date.now(), random = Math.random }) {
  const actions = new Map();          // single-use button handlers (not persisted)
  let pending = null;                 // open clarification
  let lastSaved = null;               // { ids, ts, kind: 'acts'|'sessions' }
  let lastLog = null;                 // duplicate protection { norm, ts }
  let seq = 0;

  const pick = a => a[Math.floor(random() * a.length)];
  const action = (label, fn, style = '') => { const id = 'act-' + (++seq) + '-' + now().toString(36); actions.set(id, fn); return { id, label, style }; };
  const reply = (text, extra = {}) => ({ text, kind: 'answer', actions: [], ...extra });
  const storageError = what => reply(`I couldn't save ${what} — this device refused to store it (storage full or blocked). Nothing was recorded.`, { kind: 'error' });

  /* ---------- engine selection with safe fallback ---------- */
  async function interpret(text) {
    const s = store.settings, ctx = { now: now(), history: store.chat.slice(-6) };
    const rules = parse(text, ctx);
    if (s.ai === 'rules' || !engines[s.ai]) return { interp: rules, engine: 'rules', grounded: false };
    try {
      const raw = await engines[s.ai].interpret(text, ctx);
      const interp = sanitize(raw, ctx.now);
      // safety net: a model that misses an obvious log/question loses to the deterministic parser
      if ((interp.intent === 'unknown' || (interp.intent === 'log' && !interp.items.length)) && rules.intent !== 'unknown') return { interp: rules, engine: 'rules', grounded: false, note: 'model unsure — used built-in parser' };
      return { interp, engine: s.ai, grounded: true };
    } catch (e) {
      return { interp: rules, engine: 'rules', grounded: false, note: `${engines[s.ai].name} unavailable (${e.message}) — used built-in parser` };
    }
  }

  /* ---------- saving ---------- */
  function saveRecords(records, src) {
    const res = store.addActivities(records, src);
    if (!res.ok) return { ok: false, error: res.error };
    lastSaved = { ids: res.records.map(r => r.id), ts: now(), kind: 'acts', records: res.records };
    return res;
  }
  function savedReply(res, extraQuestion) {
    const recs = res.records, n = now(), days = [...new Set(recs.map(r => r.day))];
    const dp = days.length === 1 ? ' ' + dayPhrase(days[0], n) : '';
    const d = r => describe(r) + (r.note ? ` (${r.note.replace(/(\d) k\b/, '$1 km')} noted)` : '');
    let text = recs.length === 1 ? `${pick(PRAISE)} I've recorded ${d(recs[0])}${dp}.` : `Recorded${dp}:\n${recs.map(r => '• ' + d(r) + (days.length > 1 ? ` (${dayPhrase(r.day, n).replace('for ', '')})` : '')).join('\n')}`;
    const goals = goalProgress(store.activities, store.goals, dkey(n)).filter(g => recs.some(r => r.name === g.name && r.day === dkey(n)));
    for (const g of goals) text += `\n${g.label} today: ${fmtQty(g.done, g.unit)} / ${fmtQty(g.target, g.unit)}${g.met ? ' — goal reached! 🎯' : ''}`;
    if (extraQuestion) text += '\n\n' + extraQuestion;
    const ids = recs.map(r => r.id);
    return reply(text, { kind: 'saved', records: recs, event: goals.some(g => g.met) ? 'goal' : 'saved', actions: [action('Undo', () => undoAdd(ids), 'ghost')] });
  }
  function undoAdd(ids) {
    const still = ids.filter(id => store.activity(id));
    if (!still.length) return reply('Those entries were already removed.');
    const res = store.deleteActivities(still, 'chat');
    if (!res.ok) return storageError('the undo');
    return reply(`Undone — removed ${res.records.map(describe).join(', ')}.`, { kind: 'saved' });
  }

  /* ---------- clarifications ---------- */
  function ask(issue, src) {
    pending = { ...issue, src, ts: now() };
    const acts = (issue.options || []).map(o => action(o, () => answerChoice(o)));
    return reply(issue.question, { kind: 'question', actions: acts });
  }
  async function answerChoice(choice) { return handle(choice, 'button'); }

  async function resolvePending(text, src) {
    const p = pending, s = normalize(text);
    if (now() - p.ts > 15 * 60000) { pending = null; return null; }                      // stale question
    if (p.kind === 'confirm') {
      if (YES.test(s) || s === normalize(p.yesLabel || '')) { pending = null; return p.onYes(); }
      if (NO.test(s) || s === normalize(p.noLabel || '')) { pending = null; return reply('Okay — nothing changed.'); }
      pending = null; return null;
    }
    if (p.kind === 'ambiguous') {
      if (/pomodoro|focus/.test(s)) { pending = null; return logItems([{ activity: 'pomodoro', quantity: p.item.quantity, unit: 'sessions', date: p.item.date }], text, src, false); }
      if (/something else|other|no\b/.test(s)) { pending = { kind: 'name', item: p.item, ts: now(), src }; return reply('What activity was it? (e.g. “3 study sessions” or “3 guitar sessions”)', { kind: 'question' }); }
      pending = null; return null;
    }
    if (p.kind === 'name') { pending = null; const it = parse(text, { now: now() }).items[0]; if (it && it.activity) return logItems([{ ...it, quantity: it.quantity ?? p.item.quantity, date: it.date || p.item.date }], text, src, false); return logItems([{ activity: s.replace(/\b(sessions?|it was|it's|its)\b/g, '').trim(), custom: true, quantity: p.item.quantity, unit: 'times', date: p.item.date }], text, src, false); }
    if (p.kind === 'large') {
      if (YES.test(s)) { pending = null; const res = saveRecords([p.record], src); return res.ok ? savedReply(res) : storageError('that'); }
      if (NO.test(s)) { pending = null; return reply('Okay, not saved. What was the right amount?', { kind: 'question' }); }
      pending = null; return null;
    }
    if (p.kind === 'quantity' || p.kind === 'unit' || p.kind === 'invalid') {
      const parsed = parse(text, { now: now() }), it0 = parsed.items[0];
      const otherActivity = it0 && it0.activity && resolveActivity(it0.activity) && resolveActivity(it0.activity).name !== p.item.activity;
      if (parsed.intent !== 'log' && parsed.intent !== 'unknown' || otherActivity) { pending = null; return null; }   // user moved on
      const q = quantities(s)[0];
      const unitOnly = !q && unitOf(s.replace(/^(in |it was |they were )/, '').trim());
      if (!q && !unitOnly) { if (NO.test(s)) { pending = null; return reply('No problem — nothing was recorded.'); } return reply(p.question, { kind: 'question' }); }
      pending = null;
      const item = unitOnly ? { ...p.item, unit: s.trim() } : { ...p.item, quantity: q.value, unit: q.unitWord || (p.kind === 'unit' ? null : p.item.unit) };
      if (unitOnly && item.quantity == null) return ask({ kind: 'quantity', item, question: askQuantity(catalogActivity(item.activity)) }, src);
      return logItems([item], text, src, false);
    }
    if (p.kind === 'future' || p.kind === 'date') {
      const d = findDate(normalize(text), now()); pending = null;
      if (d && !d.future) return logItems([{ ...p.item, date: d.key, future: false }], text, src, false);
      return null;
    }
    pending = null; return null;
  }

  /* ---------- log ---------- */
  function logItems(items, text, src, grounded, opts = {}) {
    const n = now(), { records, issues } = validateItems(items, { now: n, text, grounded });
    const focus = records.filter(r => r.name === 'pomodoro'), customs = records.filter(r => r.custom), normal = records.filter(r => r.name !== 'pomodoro' && !r.custom);
    // "only did 8" right after logging 10 of the same thing: correction or extra set?
    if (opts.maybeCorrection && normal.length === 1 && lastSaved && lastSaved.kind === 'acts' && n - lastSaved.ts < 30 * 60000) {
      const prev = lastSaved.records.find(r => r.name === normal[0].name && r.unit === normal[0].unit && store.activity(r.id));
      if (prev) return chooser(prev, normal[0], src);
    }
    let saved = null;
    if (normal.length) {
      const res = saveRecords(normal, src);
      if (!res.ok) return storageError(normal.length > 1 ? 'those activities' : describe(normal[0]));
      saved = res;
    }
    const followUps = [];
    if (focus.length) followUps.push(() => confirmSessions(focus[0], src));
    for (const c of customs) followUps.push(() => confirmCustom(c, src));
    if (issues.length) followUps.push(() => issues[0].kind === 'large' ? confirmLarge(issues[0], src) : ask(issues[0], src));
    if (saved) {
      const next = followUps[0] ? followUps[0]() : null;
      const r = savedReply(saved, next ? next.text : '');
      if (next) r.actions = r.actions.concat(next.actions || []), r.kind = 'saved';
      return r;
    }
    if (followUps.length) return followUps[0]();
    return reply('I didn’t find anything to record in that. Try “I did 20 squats” or “I read 15 pages”.');
  }
  function chooser(prev, rec, src) {
    const fix = action('Correct it', () => doUpdate(prev, rec.qty, src)), more = action(`Add ${fmtQty(rec.qty, rec.unit)} more`, () => { const res = saveRecords([rec], src); return res.ok ? savedReply(res) : storageError(describe(rec)); }, 'ghost');
    pending = { kind: 'confirm', ts: now(), onYes: () => doUpdate(prev, rec.qty, src), yesLabel: 'Correct it', noLabel: 'no' };
    return reply(`Is that a correction of your earlier entry (${describe(prev)} → ${fmtQty(rec.qty, rec.unit)}), or ${fmtQty(rec.qty, rec.unit)} more?`, { kind: 'question', actions: [fix, more] });
  }
  function confirm(question, yesLabel, onYes, noLabel = 'Cancel') {
    pending = { kind: 'confirm', ts: now(), onYes, yesLabel, noLabel };
    return reply(question, { kind: 'question', actions: [action(yesLabel, () => { pending = null; return onYes(); }), action(noLabel, () => { pending = null; return reply('Okay — nothing changed.'); }, 'ghost')] });
  }
  function confirmLarge(issue, src) {
    return confirm(issue.question, 'Yes, save it', () => { const res = saveRecords([issue.record], src); return res.ok ? savedReply(res) : storageError('that'); }, 'No');
  }
  function confirmCustom(rec, src) {
    return confirm(`“${rec.label}” isn't one of my built-in activities. Save it as a custom activity: ${fmtQty(rec.qty, rec.unit)} ${rec.label.toLowerCase()} ${dayPhrase(rec.day, now())}?`, 'Save', () => { const res = saveRecords([rec], src); return res.ok ? savedReply(res) : storageError(rec.label); });
  }
  function confirmSessions(rec, src) {
    const min = store.settings.focus, n = Math.round(rec.qty);
    return confirm(`Add ${n} completed focus session${n === 1 ? '' : 's'} of ${min} min ${dayPhrase(rec.day, now())} to your history? They count as focus time but earn no XP, because the timer didn't track them.`, 'Add sessions', () => {
      const res = store.addManualSessions(n, min, rec.day);
      if (!res.ok || !res.sessions.length) return storageError('the sessions');
      lastSaved = { ids: res.sessions.map(e => e.id), ts: now(), kind: 'sessions' };
      const ids = lastSaved.ids;
      return reply(`Added ${res.sessions.length} focus session${res.sessions.length === 1 ? '' : 's'} (${fmtDur(res.sessions.reduce((a, e) => a + e.s, 0))}) ${dayPhrase(rec.day, now())}.`, { kind: 'saved', event: 'saved', actions: [action('Undo', () => { const k = store.removeSessions(ids); return reply(k ? `Removed ${k} session${k === 1 ? '' : 's'}.` : 'Already removed.'); }, 'ghost')] });
    });
  }

  /* ---------- correct / delete ---------- */
  function findTarget(name, day) {
    const n = now(), acts = store.activities;
    if (!name && lastSaved && lastSaved.kind === 'acts') { const live = lastSaved.ids.map(id => store.activity(id)).filter(Boolean); if (live.length) return live; }
    const pool = acts.filter(a => (!name || a.name === name) && (!day || a.day === day)).sort((a, b) => b.created - a.created);
    if (!pool.length) return [];
    const recent = lastSaved && lastSaved.kind === 'acts' ? pool.filter(a => lastSaved.ids.includes(a.id)) : [];
    return recent.length ? [recent[0]] : [pool[0]];
  }
  function doUpdate(prev, qty, src) {
    const res = store.updateActivity(prev.id, { qty }, src);
    if (!res.ok) return res.error === 'storage' ? storageError('the change') : reply('That amount isn’t valid, so I left the entry unchanged.', { kind: 'error' });
    lastSaved = { ids: [prev.id], ts: now(), kind: 'acts', records: [res.record] };
    const before = res.before;
    return reply(`Updated: ${describe(before)} → ${describe(res.record)} ${dayPhrase(res.record.day, now())}.`, { kind: 'saved', records: [res.record], actions: [action('Undo', () => { const r2 = store.updateActivity(before.id, { qty: before.qty, unit: before.unit, day: before.day }, src); return r2.ok ? reply(`Restored ${describe(before)}.`) : storageError('the undo'); }, 'ghost')] });
  }
  function correct(interp, text, src) {
    const it = interp.items.find(i => i.quantity != null || i.date) || interp.items[0] || {};
    const act = resolveActivity(it.activity);
    const targets = findTarget(act ? act.name : null, null);
    if (!targets.length) {
      if (act && it.quantity != null) return confirm(`I couldn't find an earlier ${act.label.toLowerCase()} entry to correct. Log ${fmtQty(it.quantity, unitOf(it.unit)?.unit || act.bare || act.units[0])} ${act.label.toLowerCase()} as a new entry?`, 'Log it', () => logItems([it], text, src, false));
      return reply('I couldn’t find a recent entry to correct. You can edit any entry in the Track tab.');
    }
    if (targets.length > 1 && !act) return reply(`Which one should I change? Say e.g. “actually ${targets[0].name}: ${targets[0].qty}”.`, { kind: 'question' });
    const prev = targets[0];
    if (it.date && it.quantity == null) {                                // "actually that was yesterday"
      const res = store.updateActivity(prev.id, { day: it.date, at: new Date(+it.date.slice(0, 4), +it.date.slice(5, 7) - 1, +it.date.slice(8, 10), 12).getTime() }, src);
      return res.ok ? reply(`Moved ${describe(res.record)} to ${dayPhrase(it.date, now()).replace('for ', '')}.`, { kind: 'saved' }) : storageError('the change');
    }
    if (it.quantity == null) return reply(`What should the ${prev.label.toLowerCase()} entry be changed to?`, { kind: 'question' });
    const v = validateItems([{ activity: prev.name, quantity: it.quantity, unit: it.unit || null, date: prev.day, custom: !!prev.custom }], { now: now(), text, grounded: false });
    const rec = v.records[0];
    if (!rec || rec.unit !== prev.unit) return reply(`${prev.label} is tracked in ${prev.unit}. What should the amount be?`, { kind: 'question' });
    if (rec.qty === prev.qty) return reply(`That entry is already ${describe(prev)}.`);
    return doUpdate(prev, rec.qty, src);
  }
  function del(interp, src) {
    const it = interp.items[0], act = it && resolveActivity(it.activity);
    if (interp.target === 'all') return reply('I won’t delete everything from chat. To erase all data, use Settings → Data → Reset (it asks for confirmation).');
    if (!act && lastSaved && lastSaved.kind === 'sessions') { const ids = lastSaved.ids; return confirm(`Remove the ${ids.length} focus session${ids.length === 1 ? '' : 's'} you just added?`, 'Remove', () => { const k = store.removeSessions(ids); lastSaved = null; return reply(`Removed ${k} session${k === 1 ? '' : 's'}.`); }, 'Keep'); }
    const targets = findTarget(act ? act.name : null, it && it.date);
    if (!targets.length) return reply(act ? `I don't see any ${act.label.toLowerCase()} entries to delete.` : 'I don’t see a recent entry to delete. You can manage all entries in the Track tab.');
    const what = targets.map(t => `${describe(t)} (${dayPhrase(t.day, now()).replace('for ', '')})`).join(', ');
    return confirm(`Delete ${what}?`, 'Delete', () => {
      const res = store.deleteActivities(targets.map(t => t.id), src);
      if (!res.ok) return res.error === 'storage' ? storageError('the deletion') : reply('That entry no longer exists.');
      if (lastSaved) lastSaved.ids = lastSaved.ids.filter(id => !targets.some(t => t.id === id));
      const removed = res.records;
      return reply(`Deleted ${removed.map(describe).join(', ')}.`, { kind: 'saved', actions: [action('Undo', () => { const r2 = store.restoreActivities(removed, src); return r2.ok ? reply(`Restored ${r2.records.map(describe).join(', ')}.`) : storageError('the undo'); }, 'ghost')] });
    }, 'Keep');
  }

  /* ---------- goals ---------- */
  function setGoal(g) {
    if (!g || g.quantity == null || !(g.quantity > 0)) return reply('What should the daily goal be? e.g. “set my push-up goal to 50”.', { kind: 'question' });
    if (g.target === 'focus') {
      const q = Math.round(g.quantity); if (q < 1 || q > 20) return reply('The focus goal can be 1–20 sessions a day.');
      store.setSettings({ goal: q }); return reply(`Done — your daily focus goal is now ${q} session${q === 1 ? '' : 's'}.`, { kind: 'saved' });
    }
    const act = resolveActivity(g.target);
    if (!act || act.name === 'pomodoro') return reply('Which activity is the goal for? e.g. “set my daily push-up goal to 50”.', { kind: 'question' });
    const v = validateItems([{ activity: act.name, quantity: g.quantity, unit: g.unit }], { now: now() });
    const rec = v.records[0] || (v.issues[0] && v.issues[0].record);
    if (!rec) return reply(v.issues[0] ? v.issues[0].question.replace(/did you complete\?|\?$/, 'per day?') : 'That goal doesn’t look valid.', { kind: 'question' });
    const res = store.setGoal(act.name, rec.qty, rec.unit);
    return res.ok ? reply(`Daily goal set: ${fmtQty(res.goal.qty, res.goal.unit)} ${act.label.toLowerCase()} a day. I'll show your progress in Track.`, { kind: 'saved' }) : storageError('the goal');
  }

  /* ---------- timer ---------- */
  function timerCmd(t) {
    const r = timer[t.action] ? timer[t.action](t) : { ok: false, text: 'I can’t do that with the timer.' };
    return reply(r.text, { kind: r.ok ? 'saved' : 'answer' });
  }

  /* ---------- questions (read-only) ---------- */
  function answer(q) {
    const n = now(), range = q.range || 'today', r = resolveRange(range, n), lbl = RANGE_LABEL[range] || range;
    const hist = store.history, acts = store.activities;
    const fact = t => t;
    switch (q.metric) {
      case 'activity': {
        const act = resolveActivity(q.activity), name = act ? act.name : q.activity;
        if (!name) return reply('Which activity? e.g. “How many push-ups did I do this week?”');
        const tot = totalOf(acts, name, r), units = Object.keys(tot), entries = acts.filter(a => a.name === name && a.day >= r.from && a.day <= r.to);
        if (!units.length) return reply(`No ${labelOf(name).toLowerCase()} recorded ${lbl}.`);
        const days = new Set(entries.map(a => a.day)).size;
        return reply(`${cap(lbl)}: ${units.map(u => describe({ name, unit: u, qty: tot[u] })).join(' and ')} — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} over ${days} day${days === 1 ? '' : 's'}.`);
      }
      case 'focus_time': case 'focus_sessions': {
        const f = focusIn(hist, r), live = range === 'today' && timer.liveFocusSec ? timer.liveFocusSec() : 0;
        if (!f.sec && !live) return reply(`No focus time recorded ${lbl}.`);
        const base = q.metric === 'focus_time' ? `You focused ${fmtDur(f.sec)} ${lbl} — ${f.done} completed session${f.done === 1 ? '' : 's'}${f.cut ? `, ${f.cut} interrupted` : ''}.` : `You completed ${f.done} focus session${f.done === 1 ? '' : 's'} ${lbl} (${fmtDur(f.sec)} of focus${f.cut ? `, ${f.cut} interrupted` : ''}).`;
        return reply(base + (f.manual ? ` ${f.manual} of them ${f.manual === 1 ? 'was' : 'were'} added by hand.` : '') + (live ? ` Plus ${fmtDur(live)} in the session running now.` : ''));
      }
      case 'exercise_days': {
        const t = activityTotals(acts, r), total = r.from === '0000-01-01' ? null : dayNum(r.to) - dayNum(r.from) + 1;
        return reply(t.exerciseDays ? `You exercised on ${t.exerciseDays} day${t.exerciseDays === 1 ? '' : 's'} ${lbl}${total ? ` (out of ${total})` : ''}.` : `No exercise recorded ${lbl}.`);
      }
      case 'streak': {
        const s = stats(hist, store.tasks, n);
        return reply(`Focus streak: ${s.streak} day${s.streak === 1 ? '' : 's'} (best ${s.best}). A day counts when you finish at least one XP-earning focus session.`);
      }
      case 'level': { const xp = store.totalXp(), li = levelInfo(xp), rk = rankInfo(xp); return reply(`Level ${li.level}, Rank ${rk.r} · ${rk.title}. ${xp.toLocaleString('en-US')} XP total, ${li.toNext} XP to the next level.`); }
      case 'evolution': { const d = discipline(hist, n); return reply(`I'm a ${d.stage.name} right now — ${d.points} discipline points${d.next ? `, ${d.toGo} more to become ${d.next.name}` : ', fully evolved'}. Points come from active days, strong days (4+ sessions) and your best streak.`); }
      case 'tasks': { const done = store.tasks.filter(t => t.done && t.doneAt && dkey(t.doneAt) >= r.from && dkey(t.doneAt) <= r.to).length, open = store.tasks.filter(t => !t.done).length; return reply(`Tasks completed ${lbl}: ${done}. Open tasks: ${open}.`); }
      case 'goals': return reply(goalsText(n));
      case 'progress': return reply(progressText(n));
      case 'advice': return reply(adviceText(n));
      default: return reply(summaryText(range, n));
    }
  }
  function summaryText(range, n) {
    const r = resolveRange(range, n), lbl = RANGE_LABEL[range] || range, f = focusIn(store.history, r), t = activityTotals(store.activities, r);
    const tasks = store.tasks.filter(x => x.done && x.doneAt && dkey(x.doneAt) >= r.from && dkey(x.doneAt) <= r.to).length;
    const lines = [];
    if (f.sec) lines.push(`• Focus: ${fmtDur(f.sec)} · ${f.done} completed session${f.done === 1 ? '' : 's'}`);
    for (const a of t.list.slice(0, 8)) lines.push(`• ${cap(describe({ name: a.name, unit: a.unit, qty: a.qty, label: a.label }))}`);
    if (tasks) lines.push(`• Tasks completed: ${tasks}`);
    if (!lines.length) return `Nothing recorded ${lbl} yet. Start a focus session or tell me what you did.`;
    let out = `Here's what you did ${lbl}:\n${lines.join('\n')}`;
    if (range === 'today') { const g = store.settings.goal, done = focusIn(store.history, r).done; out += `\n\nFocus goal: ${done}/${g} sessions${done >= g ? ' — reached 🎯' : ''}.`; }
    return out;
  }
  function progressText(n) {
    const s = series(store.history, store.activities, 7, n), goal = store.settings.goal;
    const lines = s.map(d => { const dt = new Date(+d.k.slice(0, 4), +d.k.slice(5, 7) - 1, +d.k.slice(8, 10), 12); return `• ${dt.toLocaleDateString('en-US', { weekday: 'short' })} ${dt.getDate()}: ${d.sec ? fmtDur(d.sec) + ' focus' : 'no focus'} · ${d.done}/${goal} sessions · ${d.acts} activit${d.acts === 1 ? 'y' : 'ies'}`; });
    const tot = s.reduce((a, d) => a + d.sec, 0), met = s.filter(d => d.done >= goal).length;
    return `Last 7 days:\n${lines.join('\n')}\n\nTotal focus ${fmtDur(tot)} · focus goal met on ${met} of 7 days.`;
  }
  function goalsText(n) {
    const rates = habitRates(store.activities, store.goals, store.history, store.settings.goal, resolveRange('last_7', n));
    const lines = rates.map(g => `• ${g.label} (${fmtQty(g.target, g.unit)}/day): met ${g.met} of ${g.days} days`);
    const avg = rates.length ? rates.reduce((a, g) => a + g.rate, 0) / rates.length : 0;
    const verdict = avg >= .8 ? 'Very consistent.' : avg >= .5 ? 'Fairly consistent — room to tighten up.' : 'Not very consistent yet.';
    return `Daily goals, last 7 days:\n${lines.join('\n')}\n\n${verdict}${Object.keys(store.goals).length ? '' : '\nTip: set activity goals too, e.g. “set my push-up goal to 50”.'}`;
  }
  function adviceText(n) {
    const s7 = series(store.history, store.activities, 7, n), goal = store.settings.goal, f = focusIn(store.history, resolveRange('last_7', n));
    const met = s7.filter(d => d.done >= goal).length, activeDays = s7.filter(d => d.done > 0).length, exDays = activityTotals(store.activities, resolveRange('last_7', n)).exerciseDays;
    const facts = [`• Focus goal (${goal}/day) met on ${met} of 7 days`, `• Focused on ${activeDays} of 7 days · ${fmtDur(f.sec)} total`, `• Exercise logged on ${exDays} of 7 days`];
    if (f.cut) facts.push(`• ${f.cut} session${f.cut === 1 ? '' : 's'} interrupted vs ${f.done} completed`);
    const dp = dayparts(store.history), best = Math.max(...dp) > 0 ? DAYPARTS[dp.indexOf(Math.max(...dp))][0].toLowerCase() : null;
    const tips = [];
    if (!f.sec) tips.push('Start with one 25-minute session tomorrow — consistency beats volume.');
    else if (met < 3) tips.push(`Your goal of ${goal} sessions may be too high right now. Try ${Math.max(2, Math.round(f.done / 7) + 1)} a day and build up.`);
    if (f.cut && f.cut >= f.done / 3) tips.push('Many sessions get interrupted — try shorter sessions (15–20 min) or put your phone in another room.');
    if (exDays < 3) tips.push('Add a short movement habit, e.g. 20 push-ups after your first focus session.');
    if (best) tips.push(`Schedule your hardest task in the ${best} — that's when you've focused most.`);
    if (!tips.length) tips.push('You’re doing well. Keep the same rhythm and protect your streak.');
    return `What your data shows (last 7 days):\n${facts.join('\n')}\n\nSuggestions (my recommendations, not data):\n${tips.slice(0, 3).map(t => '• ' + t).join('\n')}`;
  }

  /* ---------- entry point ---------- */
  async function handle(text, src = 'chat') {
    text = String(text || '').trim();
    if (!text) return null;
    if (text.length > 600) return reply('That message is a bit long for me — could you split it up?');
    const recSrc = src === 'voice' ? 'voice' : 'chat';
    if (pending) { const r = await resolvePending(text, recSrc); if (r) return r; }
    const { interp, engine, grounded, note } = await interpret(text);
    const meta = { engine, note };
    const norm = normalize(text);
    let out;
    switch (interp.intent) {
      case 'log': {
        if (lastLog && lastLog.norm === norm && now() - lastLog.ts < 90000 && src !== 'button') {
          out = confirm('You just logged exactly that. Log it again as a separate entry?', 'Log again', () => logItems(interp.items, text, recSrc, grounded), 'No');
          break;
        }
        lastLog = { norm, ts: now() };
        out = logItems(interp.items, text, recSrc, grounded, { maybeCorrection: /\bonly\b/.test(norm) });
        break;
      }
      case 'correct': out = correct(interp, text, recSrc); break;
      case 'delete': out = del(interp, recSrc); break;
      case 'goal': out = setGoal(interp.goal); break;
      case 'timer': out = timerCmd(interp.timer || { action: 'start', mode: 'focus' }); break;
      case 'query': out = answer(interp.query || { metric: 'summary', range: 'today' }); break;
      case 'greet': out = reply(`Hey! 🐺 ${greetLine()}\nTell me what you did — “I did 20 squats” — or ask “What did I accomplish today?”`); break;
      case 'thanks': out = reply(pick(['Anytime. Keep going!', 'Always. The pack has your back.', 'You did the work — I just wrote it down.'])); break;
      case 'help': out = reply('Here’s what I can do:\n• Record activities — “I did 30 push-ups”, “read 15 pages”, “ran 5 km yesterday”\n• Fix or remove entries — “actually it was 25”, “delete my last squats”\n• Answer from your data — “How much did I focus this week?”\n• Control the timer — “start a 50 minute focus session”\n• Set goals — “set my push-up goal to 50”\nEverything stays on this device.'); break;
      default: {
        if (/\b(actually|i meant)\b/.test(norm) && findDate(norm, now()) && lastSaved) { out = correct({ items: [{ date: findDate(norm, now()).key }] }, text, recSrc); break; }
        out = reply('I didn’t quite get that, so nothing was saved. You can tell me what you did (“I did 20 squats”), ask about your progress (“How many push-ups this week?”), or say “help”.');
      }
    }
    return { ...out, ...meta };
  }
  function greetLine() {
    const f = focusIn(store.history, resolveRange('today', now()));
    return f.done ? `${f.done} focus session${f.done === 1 ? '' : 's'} done today — nice.` : 'Ready when you are.';
  }

  return {
    handle,
    async act(id) { const fn = actions.get(id); if (!fn) return reply('That button has expired — just tell me again.'); actions.delete(id); const r = await fn(); return r; },
    hasAction: id => actions.has(id),
    get pending() { return pending; },
    reset() { pending = null; lastSaved = null; lastLog = null; actions.clear(); }
  };
}
