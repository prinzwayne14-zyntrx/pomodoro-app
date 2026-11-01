// Track view (manual logging + entry history) and the Activity tab of Statistics.
// Manual logging uses the SAME validator as the chat, so both paths produce identical records.
import { ACTIVITIES, activity as catAct, describe, fmtQty, labelOf, UNITS, LIMITS } from '../catalog.js';
import { validateItems } from '../ai/validate.js';
import { resolveRange, activityTotals, totalOf, goalProgress, habitRates, series, activityStreak } from '../analytics.js';
import { dkey, dayNum } from '../rpg.js';

const UNIT_NAME = { reps: 'reps', sec: 'seconds', min: 'minutes', pages: 'pages', ml: 'ml', km: 'km', steps: 'steps', times: 'times', sessions: 'sessions' };
const CUSTOM_UNITS = ['times', 'reps', 'min', 'sec', 'km', 'pages', 'ml'];
const DEFAULT_QUICK = [['push-ups', 10, 'reps'], ['squats', 20, 'reps'], ['plank', 30, 'sec'], ['water', 250, 'ml'], ['reading', 10, 'pages'], ['study', 25, 'min']];
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const dayLabel = (k, now = Date.now()) => { const d = dayNum(dkey(now)) - dayNum(k); if (d === 0) return 'Today'; if (d === 1) return 'Yesterday'; return new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), 12).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
const unitsFor = name => { const a = catAct(name); return a ? a.units : CUSTOM_UNITS; };

export function initTrack(ctx) {
  const { store, $, esc, toast, dialog, onChange } = ctx;
  const el = $('trackView');
  let shown = 30;

  function quickList() {
    const since = dkey(Date.now() - 30 * 864e5), count = new Map(), last = new Map();
    for (const a of store.activities) if (a.day >= since && a.name !== 'pomodoro') { const k = a.name + '|' + a.unit; count.set(k, (count.get(k) || 0) + 1); last.set(k, a.qty); }
    const top = [...count.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k]) => { const [n, u] = k.split('|'); return [n, last.get(k), u]; });
    for (const d of DEFAULT_QUICK) if (top.length < 6 && !top.some(t => t[0] === d[0])) top.push(d);
    return top;
  }
  function render() {
    const today = dkey(Date.now()), goals = goalProgress(store.activities, store.goals, today);
    const focusDone = store.history.filter(h => h.m === 'focus' && h.c && dkey(h.t) === today).length, fg = store.settings.goal;
    const goalRows = [`<div class="gl ${focusDone >= fg ? 'met' : ''}"><b>Focus sessions</b><span>${focusDone} / ${fg}</span><div class="bar"><i style="width:${Math.min(100, focusDone / fg * 100)}%"></i></div></div>`]
      .concat(goals.map(g => `<div class="gl ${g.met ? 'met' : ''}"><b>${esc(g.label)}</b><span>${fmtQty(g.done, g.unit)} / ${fmtQty(g.target, g.unit)}${g.met ? ' ✓' : ''}</span><div class="bar"><i style="width:${g.pct * 100}%"></i></div></div>`)).join('');
    const quick = quickList().map(([n, q, u]) => `<button type="button" data-q="${esc(n)}|${q}|${u}"><b>+${esc(fmtQty(q, u))}</b> ${esc(labelOf(n).toLowerCase())}</button>`).join('');
    const opts = ACTIVITIES.filter(a => a.name !== 'pomodoro').map(a => `<option value="${a.name}">${a.label}</option>`).join('');
    const customs = [...new Set(store.activities.filter(a => a.custom).map(a => a.name))].map(n => `<option value="${esc(n)}">${esc(labelOf(n))}</option>`).join('');
    // recent entries grouped by day (newest first)
    const list = store.activities.slice().sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at).slice(0, shown);
    let rows = '', lastDay = '';
    for (const a of list) {
      if (a.day !== lastDay) { lastDay = a.day; rows += `<div class="dayhead">${esc(dayLabel(a.day))}</div>`; }
      rows += `<div class="entry" data-id="${esc(a.id)}"><span class="cat ${esc(a.cat)}"></span><div class="what"><b>${esc(capFirst(describe(a)))}</b><small>${new Date(a.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${a.note ? ' · ' + esc(a.note) : ''}</small></div><span class="src">${esc(a.src)}</span>
        <button class="eb" data-edit aria-label="Edit">${ICON_EDIT}</button><button class="eb" data-del aria-label="Delete">${ICON_DEL}</button></div>`;
    }
    el.innerHTML = `
      <h1 class="vtitle">Track</h1>
      <div class="card goalcard"><div class="thead"><h2>Today’s goals</h2><button class="btn-sm ghost" type="button" id="addGoalBtn">Add goal</button></div>${goalRows}
        ${goals.length ? '' : '<p class="fine" style="padding:6px 0 2px">Add daily goals for push-ups, water, reading… and track them here.</p>'}</div>
      <div class="section-t">Quick log</div>
      <div class="quick" id="quickRow">${quick}</div>
      <div class="section-t">Log an activity</div>
      <form class="card logform" id="logForm" autocomplete="off">
        <label class="full">Activity<select id="lfAct">${opts}${customs ? `<optgroup label="Your activities">${customs}</optgroup>` : ''}<option value="__custom">Custom activity…</option></select></label>
        <label class="full" id="lfCustomWrap" hidden>Name<input type="text" id="lfCustom" maxlength="40" placeholder="e.g. guitar practice"></label>
        <label>Amount<input type="number" id="lfQty" min="0" step="any" inputmode="decimal" placeholder="10"></label>
        <label>Unit<select id="lfUnit"></select></label>
        <label class="full">Day<input type="date" id="lfDay" max="${today}" value="${today}"></label>
        <button class="btn-sm full" type="submit">Save entry</button>
      </form>
      <div class="section-t">Recent entries</div>
      <div class="card" id="entryList">${rows || '<div class="empty">Nothing logged yet.<br>Use quick log, the form above, or just tell Zyn.</div>'}</div>
      ${store.activities.length > shown ? '<button class="btn-sm ghost" id="moreEntries" type="button" style="align-self:center">Show more</button>' : ''}`;
    fillUnits();
  }
  const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
  function fillUnits(sel) {
    const act = $('lfAct').value, custom = act === '__custom';
    $('lfCustomWrap').hidden = !custom;
    $('lfUnit').innerHTML = (custom ? CUSTOM_UNITS : unitsFor(act)).map(u => `<option value="${u}" ${u === sel ? 'selected' : ''}>${UNIT_NAME[u]}</option>`).join('');
  }

  /* saving goes through the validator; large amounts and odd units are confirmed, never silently accepted */
  async function save(name, qty, unit, day, src = 'manual', custom = false) {
    const v = validateItems([{ activity: name, quantity: qty, unit, date: day, custom }], { now: Date.now() });
    let rec = v.records[0];
    if (!rec && v.issues[0] && v.issues[0].kind === 'large') {
      const ok = await dialog({ title: 'Is that right?', text: v.issues[0].question, buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Save', value: true, primary: true }] });
      if (ok !== true) return false; rec = v.issues[0].record;
    }
    if (!rec) { toast(v.issues[0] ? v.issues[0].question : 'Check the amount'); return false; }
    const res = store.addActivities([rec], src);
    if (!res.ok) { toast(res.error === 'storage' ? 'Could not save — device storage is full or blocked' : 'That entry is not valid'); return false; }
    const ids = res.records.map(r => r.id);
    toast(`Saved: ${describe(res.records[0])}`, 4000, { label: 'Undo', fn: () => { store.deleteActivities(ids, 'manual'); onChange(); } });
    onChange({ kind: 'saved', records: res.records });
    return true;
  }

  el.addEventListener('change', e => { if (e.target.id === 'lfAct') fillUnits(); });
  el.addEventListener('submit', async e => {
    if (e.target.id !== 'logForm') return; e.preventDefault();
    const sel = $('lfAct').value, custom = sel === '__custom', name = custom ? $('lfCustom').value.trim().toLowerCase() : sel;
    const qty = parseFloat($('lfQty').value), unit = $('lfUnit').value, day = $('lfDay').value || dkey(Date.now());
    if (!name) return toast('Give the activity a name');
    if (!(qty > 0)) return toast('Enter an amount greater than 0');
    if (await save(name, qty, unit, day, 'manual', custom || !catAct(name))) { $('lfQty').value = ''; }
  });
  el.addEventListener('click', async e => {
    const q = e.target.closest('[data-q]');
    if (q) { const [n, qty, u] = q.dataset.q.split('|'); return save(n, +qty, u, dkey(Date.now()), 'manual', !catAct(n)); }
    if (e.target.id === 'moreEntries') { shown += 40; return render(); }
    if (e.target.closest('#addGoalBtn')) return goalDialog();
    const row = e.target.closest('.entry'); if (!row) return;
    const a = store.activity(row.dataset.id); if (!a) return render();
    if (e.target.closest('[data-del]')) {
      const ok = await dialog({ title: 'Delete entry?', text: `${capFirst(describe(a))} · ${dayLabel(a.day)}`, buttons: [{ label: 'Cancel', value: false, cls: 'ghost', primary: true }, { label: 'Delete', value: true, cls: 'danger' }] });
      if (ok !== true) return;
      const res = store.deleteActivities([a.id], 'manual');
      if (!res.ok) return toast('Could not delete — storage error');
      toast('Entry deleted', 4000, { label: 'Undo', fn: () => { store.restoreActivities(res.records, 'manual'); onChange(); } });
      return onChange();
    }
    if (e.target.closest('[data-edit]')) return editDialog(a);
  });

  async function editDialog(a) {
    const units = unitsFor(a.name);
    const r = await dialog({
      title: 'Edit ' + labelOf(a.name).toLowerCase(),
      body: `<label for="edQty">Amount</label><input type="number" id="edQty" step="any" min="0" value="${a.qty}">
        <label for="edUnit">Unit</label><select id="edUnit">${units.map(u => `<option value="${u}" ${u === a.unit ? 'selected' : ''}>${UNIT_NAME[u]}</option>`).join('')}</select>
        <label for="edDay">Day</label><input type="date" id="edDay" value="${a.day}" max="${dkey(Date.now())}">`,
      buttons: [{ label: 'Cancel', value: null, cls: 'ghost' }, { label: 'Save', value: 'save', primary: true }]
    });
    if (r !== 'save') return;
    const qty = parseFloat(document.getElementById('edQty').value), unit = document.getElementById('edUnit').value, day = document.getElementById('edDay').value;
    if (!(qty > 0) || !UNITS[unit] || !day || day > dkey(Date.now())) return toast('Not saved — check amount and day');
    if (['reps', 'times', 'steps'].includes(unit) && !Number.isInteger(qty)) return toast('Not saved — use a whole number');
    if (qty > LIMITS[unit] * 10) return toast('Not saved — that amount is too large');
    const res = store.updateActivity(a.id, { qty, unit, day, at: day === a.day ? a.at : new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), 12).getTime() }, 'manual');
    if (!res.ok) return toast(res.error === 'storage' ? 'Could not save — storage error' : 'That change is not valid');
    toast('Entry updated', 4000, { label: 'Undo', fn: () => { store.updateActivity(a.id, { qty: a.qty, unit: a.unit, day: a.day, at: a.at }, 'manual'); onChange(); } });
    onChange();
  }
  async function goalDialog(name) {
    const opts = ACTIVITIES.filter(a => a.name !== 'pomodoro').map(a => `<option value="${a.name}" ${a.name === name ? 'selected' : ''}>${a.label}</option>`).join('');
    const r = await dialog({
      title: 'Daily goal',
      body: `<label for="gAct">Activity</label><select id="gAct">${opts}</select><label for="gQty">Target per day</label><input type="number" id="gQty" min="1" step="any" value="${name && store.goals[name] ? store.goals[name].qty : ''}" placeholder="50"><label for="gUnit">Unit</label><select id="gUnit"></select>`,
      buttons: [{ label: 'Cancel', value: null, cls: 'ghost' }, ...(name && store.goals[name] ? [{ label: 'Remove', value: 'rm', cls: 'danger' }] : []), { label: 'Save', value: 'save', primary: true }],
      onOpen: () => { const fill = () => { const a = document.getElementById('gAct').value; document.getElementById('gUnit').innerHTML = unitsFor(a).map(u => `<option value="${u}" ${store.goals[a] && store.goals[a].unit === u ? 'selected' : ''}>${UNIT_NAME[u]}</option>`).join(''); }; fill(); document.getElementById('gAct').onchange = fill; }
    });
    if (r === 'rm') { store.removeGoal(name); onChange(); return; }
    if (r !== 'save') return;
    const a = document.getElementById('gAct').value, q = parseFloat(document.getElementById('gQty').value), u = document.getElementById('gUnit').value;
    if (!(q > 0)) return toast('Enter a target greater than 0');
    const res = store.setGoal(a, q, u);
    toast(res.ok ? `Goal set: ${fmtQty(q, u)} ${labelOf(a).toLowerCase()} a day` : 'Could not save the goal'); onChange();
  }
  return { render, goalDialog };
}

/* ---------- Statistics → Activity tab ---------- */
export function activityStatsHTML(store, esc, now = Date.now()) {
  const acts = store.activities, R = k => resolveRange(k, now);
  const t = { today: activityTotals(acts, R('today')), week: activityTotals(acts, R('this_week')), month: activityTotals(acts, R('this_month')), all: activityTotals(acts, R('all')) };
  const card = (k, v, u, tip) => `<div class="card"><div class="k">${k}${tip ? `<span class="info-i" data-tip="${esc(tip)}">i</span>` : ''}</div><div class="v">${v}${u ? `<small>${u}</small>` : ''}</div></div>`;
  const exAll = acts.filter(a => a.cat === 'exercise');
  const s14 = series(store.history, acts, 14, now), max = Math.max(1, ...s14.map(d => d.acts));
  const bars = s14.slice(-7).map((d, i) => `<div class="col ${i === 6 ? 'today' : ''} ${d.acts ? 'has' : ''}" data-tip="${dayLabelLong(d.k)}: ${d.acts} entr${d.acts === 1 ? 'y' : 'ies'}"><b>${d.acts || ''}</b><div class="slot"><i style="height:${Math.max(2, d.acts / max * 100)}%"></i></div><span>${'SMTWTFS'[new Date(d.k + 'T12:00').getDay()]}</span></div>`).join('');
  // per activity table
  const names = [...new Set(acts.map(a => a.name + '|' + a.unit))];
  const cell = (n, u, k) => { const v = totalOf(acts, n, R(k))[u]; return v ? fmtQty(v, u) : '–'; };
  const table = names.length ? `<table class="atable"><thead><tr><th>Activity</th><th>Today</th><th>Week</th><th>Month</th><th>All</th></tr></thead><tbody>${names.map(k => { const [n, u] = k.split('|'); return `<tr><td>${esc(labelOf(n))} <small>${UNIT_NAME[u]}</small></td><td>${cell(n, u, 'today')}</td><td>${cell(n, u, 'this_week')}</td><td>${cell(n, u, 'this_month')}</td><td>${cell(n, u, 'all')}</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">No activities yet. Log them in Track or tell Zyn.</div>';
  const rates7 = habitRates(acts, store.goals, store.history, store.settings.goal, R('last_7')), rates30 = habitRates(acts, store.goals, store.history, store.settings.goal, R('last_30'));
  const rates = rates7.map((g, i) => `<div class="rate"><b>${esc(g.label)} <small class="muted">${fmtQty(g.target, g.unit)}/day</small></b><span>${g.met}/7 · ${Math.round(rates30[i].rate * 100)}% <small>30d</small></span><div class="bar"><i style="width:${g.rate * 100}%"></i></div></div>`).join('');
  const goals = goalProgress(acts, store.goals, dkey(now));
  const hist = exAll.slice().sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at).slice(0, 25);
  let hl = '', last = '';
  for (const a of hist) { if (a.day !== last) { last = a.day; hl += `<div class="hday">${esc(dayLabel(a.day, now))}</div>`; } hl += `<div class="hrow"><span class="dur">${esc(fmtQty(a.qty, a.unit))}</span><span class="info">${esc(labelOf(a.name))}${a.note ? ' · ' + esc(a.note) : ''}</span><span class="badge zero">${esc(a.src)}</span></div>`; }
  return `
    <div class="grid">
      ${card('Today', t.today.entries, t.today.entries === 1 ? 'entry' : 'entries', 'Activities recorded for today’s date')}
      ${card('This week', t.week.entries, 'entries', 'Monday → today')}
      ${card('This month', t.month.entries, 'entries', 'Calendar month so far')}
      ${card('All time', t.all.entries, 'entries')}
      ${card('Exercise days', t.week.exerciseDays, 'this week', 'Days with at least one exercise entry, Monday → today')}
      ${card('Exercise days', t.month.exerciseDays, 'this month', 'Days with at least one exercise entry this month')}
      ${card('Exercises logged', exAll.length, 'total', 'Number of exercise entries ever recorded')}
      ${card('Activity streak', activityStreak(acts, now), 'days', 'Consecutive days with at least one entry (today counts once you log something)')}
    </div>
    ${goals.length ? `<div class="card"><div class="k">Today’s goal progress</div>${goals.map(g => `<div class="rate"><b>${esc(g.label)}</b><span>${fmtQty(g.done, g.unit)} / ${fmtQty(g.target, g.unit)}</span><div class="bar"><i style="width:${g.pct * 100}%"></i></div></div>`).join('')}</div>` : ''}
    <div class="card"><div class="chead"><div class="k">Habit completion<span class="info-i" data-tip="Share of days on which the daily goal was met: last 7 days, and last 30 days">i</span></div></div>${rates || '<p class="fine">Set daily goals in Track to see completion rates.</p>'}</div>
    <div class="card"><div class="chead"><div class="k">Entries per day</div><div class="cnote">last 7 days</div></div><div class="bars">${bars}</div></div>
    <div class="card"><div class="k">Totals by activity<span class="info-i" data-tip="Week = Monday → today, Month = calendar month. Different units are never added together.">i</span></div>${table}</div>
    <div class="section-t">Exercise history</div>
    <div class="card hist">${hl || '<div class="empty">No exercise recorded yet.</div>'}</div>`;
}
const dayLabelLong = k => new Date(k + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
