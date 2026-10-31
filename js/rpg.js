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
  for (let i = 27; i >= 0; i--) { const k = agoKey(i, now), d = days.get(k); heat.push({ k, sec: (d ? d.sec : 0) + (i === 0 ? liveSec : 0) }); }

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

  const weekSec = week.reduce((a, d) => a + d.sec, 0);
  let bestDay = liveSec ? today.sec + liveSec : 0;
  for (const d of days.values()) if (d.sec > bestDay) bestDay = d.sec;

  const tdone = tasks.filter(t => t.done && t.doneAt);
  return {
    todaySec: today.sec + liveSec, todayN: today.n, todayXp: today.xp,
    weekSec, monthSec, avg7: weekSec / 7,
    totalSec: totalSec + liveSec, totalXp, done, cut,
    rate: done + cut ? Math.round(100 * done / (done + cut)) : null,
    streak, best, bestDay, week, heat,
    tasksDoneToday: tdone.filter(t => dkey(t.doneAt) === tk).length,
    tasksDoneTotal: tdone.length
  };
}
