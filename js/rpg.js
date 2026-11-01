// Pure functions: XP rules, levels, ranks and statistics. No DOM, no storage.

/* ---------- XP rules (transparent and fixed) ----------
   A focus session earns XP only if it ran to the end AND lasted >= 10 min.
   XP = 1 per minute (max 180) + 10 bonus if the session was >= 20 min.
   Interrupted sessions and breaks earn 0 XP. XP is stored on each session
   at the moment it is recorded, so changing these rules never rewrites history. */
export const MIN_XP_SEC = 600;
export const BONUS_SEC = 1200;
export const BONUS_XP = 10;
export const MAX_XP_MIN = 180;

export function xpFor(mode, sec, completed) {
  if (mode !== 'focus' || !completed || !(sec >= MIN_XP_SEC)) return 0;
  return Math.min(MAX_XP_MIN, Math.floor(sec / 60)) + (sec >= BONUS_SEC ? BONUS_XP : 0);
}

/* ---------- levels & ranks ---------- */
export const T = l => 50 * l * (l - 1);           // cumulative XP needed to reach level l
export function levelOf(xp) {
  xp = Math.max(0, Number(xp) || 0);
  let l = Math.max(1, Math.floor((1 + Math.sqrt(1 + 4 * xp / 50)) / 2));
  while (T(l + 1) <= xp) l++;
  while (l > 1 && T(l) > xp) l--;
  return l;
}
export const rankOf = l => l >= 40 ? 'S' : l >= 25 ? 'A' : l >= 15 ? 'B' : l >= 10 ? 'C' : l >= 5 ? 'D' : 'E';
export function levelInfo(xp) {
  const level = levelOf(xp), base = T(level), need = T(level + 1) - base;
  return { level, rank: rankOf(level), into: xp - base, need, toNext: need - (xp - base) };
}

/* ---------- local-date helpers ---------- */
const p2 = n => String(n).padStart(2, '0');
export const dkey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
export const dayNum = k => { const [y, m, d] = k.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
export const dow = k => (dayNum(k) + 4) % 7;       // 0 = Sunday
export function agoKey(n, now = Date.now()) { const d = new Date(now); d.setDate(d.getDate() - n); return dkey(d.getTime()); }

/* ---------- statistics (always computed from recorded sessions) ---------- */
export function stats(history, tasks, now = Date.now(), liveSec = 0) {
  const days = new Map();
  let totalSec = 0, done = 0, cut = 0, totalXp = 0;
  for (const h of history) {
    if (h.m !== 'focus') continue;
    const k = dkey(h.t);
    let d = days.get(k);
    if (!d) days.set(k, d = { sec: 0, n: 0, q: 0, xp: 0 });
    d.sec += h.s; d.xp += h.x; totalSec += h.s; totalXp += h.x;
    if (h.c) { d.n++; done++; if (h.x > 0) d.q++; } else cut++;
  }
  const tk = agoKey(0, now), today = days.get(tk) || { sec: 0, n: 0, q: 0, xp: 0 };

  const week = [];
  for (let i = 6; i >= 0; i--) { const k = agoKey(i, now), d = days.get(k); week.push({ k, sec: (d ? d.sec : 0) + (i === 0 ? liveSec : 0), dow: dow(k) }); }
  const heat = [];
  for (let i = 83; i >= 0; i--) { const k = agoKey(i, now), d = days.get(k); heat.push({ k, sec: (d ? d.sec : 0) + (i === 0 ? liveSec : 0) }); }

  const mp = tk.slice(0, 7);
  let monthSec = liveSec;
  for (const [k, d] of days) if (k.startsWith(mp)) monthSec += d.sec;

  // streak = consecutive days with at least one XP-earning completed session
  const act = [...days].filter(([, d]) => d.q > 0).map(([k]) => dayNum(k)).sort((a, b) => a - b);
  let best = 0, run = 0;
  act.forEach((n, i) => { run = i && n - act[i - 1] === 1 ? run + 1 : 1; if (run > best) best = run; });
  const set = new Set(act);
  let streak = 0, cur = dayNum(tk);
  if (!set.has(cur)) cur--;
  while (set.has(cur)) { streak++; cur--; }

  const last7Sec = week.reduce((a, d) => a + d.sec, 0);
  // calendar week: Monday .. today (see analytics.js for all range definitions)
  const tn = dayNum(tk), mon = tn - ((dow(tk) + 6) % 7);
  let weekSec = liveSec, doneSec = 0;
  for (const [k, d] of days) { const n = dayNum(k); if (n >= mon && n <= tn) weekSec += d.sec; }
  for (const h of history) if (h.m === 'focus' && h.c) doneSec += h.s;
  let bestDay = liveSec ? today.sec + liveSec : 0;
  for (const d of days.values()) if (d.sec > bestDay) bestDay = d.sec;

  const tdone = tasks.filter(t => t.done && t.doneAt);
  return {
    todaySec: today.sec + liveSec, todayN: today.n, todayXp: today.xp,
    weekSec, last7Sec, monthSec, avg7: last7Sec / 7, avgSession: done ? doneSec / done : 0,
    totalSec: totalSec + liveSec, totalXp, done, cut,
    rate: done + cut ? Math.round(100 * done / (done + cut)) : null,
    streak, best, bestDay, week, heat,
    tasksDoneToday: tdone.filter(t => dkey(t.doneAt) === tk).length,
    tasksDoneTotal: tdone.length
  };
}

/* ---------- ranks: titles + progress to the next rank ---------- */
export const RANKS = [
  { r: 'E', min: 1, title: 'Novice' }, { r: 'D', min: 5, title: 'Apprentice' }, { r: 'C', min: 10, title: 'Adept' },
  { r: 'B', min: 15, title: 'Expert' }, { r: 'A', min: 25, title: 'Master' }, { r: 'S', min: 40, title: 'Legend' }
];
export function rankInfo(xp) {
  const level = levelOf(xp), i = RANKS.findIndex(x => x.r === rankOf(level)), cur = RANKS[i], nx = RANKS[i + 1] || null;
  if (!nx) return { ...cur, level, next: null, frac: 1, xpToGo: 0 };
  const a = T(cur.min), b = T(nx.min);
  return { ...cur, level, next: nx, frac: Math.min(1, Math.max(0, (xp - a) / (b - a))), xpToGo: Math.max(0, b - xp) };
}

/* ---------- discipline: drives Zyn's evolution ----------
   Earned from routine, not raw hours:
     +1 for every day with at least one XP-earning focus session ("active day")
     +2 more for every day with 4+ XP-earning sessions ("strong day")
     +2 for every day of your best streak
   Points only ever grow, so a bad week never takes an evolution away.
   Vitality (how Zyn feels right now) follows your recent routine. */
export const STAGES = [
  { n: 1, min: 0, name: 'Pup', note: 'Just joined the pack.' },
  { n: 2, min: 10, name: 'Scout', note: 'Learning the trail.' },
  { n: 3, min: 40, name: 'Hunter', note: 'Focused and fearless.' },
  { n: 4, min: 100, name: 'Alpha', note: 'Leads the pack.' },
  { n: 5, min: 200, name: 'Spirit Wolf', note: 'Legendary discipline.' }
];
export const STRONG_DAY = 4;
export function discipline(history, now = Date.now()) {
  const q = new Map();
  for (const h of history) if (h.m === 'focus' && h.c && h.x > 0) { const k = dkey(h.t); q.set(k, (q.get(k) || 0) + 1); }
  const days = [...q.keys()].map(dayNum).sort((a, b) => a - b);
  let best = 0, run = 0;
  days.forEach((n, i) => { run = i && n - days[i - 1] === 1 ? run + 1 : 1; if (run > best) best = run; });
  let active = 0, strong = 0;
  for (const v of q.values()) { active++; if (v >= STRONG_DAY) strong++; }
  const points = active + 2 * strong + 2 * best;
  const i = STAGES.reduce((a, s, j) => points >= s.min ? j : a, 0), stage = STAGES[i], next = STAGES[i + 1] || null;
  const today = dayNum(dkey(now)), last = days.length ? days[days.length - 1] : null;
  const idle = last == null ? null : today - last;                     // days since the last XP-earning session
  const vitality = last == null ? 'new' : idle <= 1 ? 'strong' : idle <= 3 ? 'tired' : 'lonely';
  // 14-day score (0-100): 60% showing up, 40% strong days
  let a14 = 0, s14 = 0; const d14 = [];
  for (let d = 13; d >= 0; d--) { const k = agoKey(d, now), v = q.get(k) || 0; d14.push({ k, n: v }); if (v) a14++; if (v >= STRONG_DAY) s14++; }
  const score = Math.round(60 * a14 / 14 + 40 * s14 / 14);
  return { points, active, strong, best, stage, next, frac: next ? (points - stage.min) / (next.min - stage.min) : 1, toGo: next ? next.min - points : 0, idle, vitality, score, a14, s14, d14 };
}

/* ---------- when do you focus best? ---------- */
export const DAYPARTS = [['Morning', 5, 12], ['Afternoon', 12, 17], ['Evening', 17, 22], ['Night', 22, 29]];
export function dayparts(history) {
  const sec = [0, 0, 0, 0];
  for (const h of history) {
    if (h.m !== 'focus') continue;
    let hr = new Date(h.t - h.s * 500).getHours(); if (hr < 5) hr += 24;   // midpoint of the session
    const i = DAYPARTS.findIndex(([, a, b]) => hr >= a && hr < b); if (i >= 0) sec[i] += h.s;
  }
  return sec;
}
