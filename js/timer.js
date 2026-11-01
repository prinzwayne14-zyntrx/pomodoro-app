// Pure timer logic. Everything is computed from timestamps (never from tick counts),
// so it stays correct after a refresh, a phone lock or a long time in the background.
import { xpFor } from './rpg.js';

export const modeMs = (settings, mode) => settings[mode] * 60000;

export function newTimer(settings, mode = 'focus', completed = 0, task = null) {
  const total = modeMs(settings, mode);
  return { mode, running: false, endAt: 0, remaining: total, total, sid: null, completed, task };
}
export const remaining = (t, now) => t.running ? Math.max(0, t.endAt - now) : t.remaining;
export const elapsed = (t, now) => Math.max(0, Math.min(t.total, t.total - remaining(t, now)));
export const expired = (t, now) => t.running && now >= t.endAt;
// a session counts as "in progress" once started and not yet finished/abandoned
export const inProgress = t => !!t.sid && (t.running || t.remaining < t.total);

export function start(t, now) {
  return { ...t, sid: t.sid || `${now}-${t.mode}`, running: true, endAt: now + t.remaining };
}
export function pause(t, now) {
  return { ...t, running: false, endAt: 0, remaining: remaining(t, now) };
}

// Entry for a focus session that ran to the end (null for breaks: they are not recorded).
export function completedEntry(t) {
  if (t.mode !== 'focus' || !t.sid) return null;
  const sec = Math.round(t.total / 1000);
  const e = { id: t.sid, t: t.endAt || Date.now(), m: 'focus', s: sec, c: 1, x: xpFor('focus', sec, true) };
  if (t.task) e.k = t.task;
  return e;
}
// Entry for a focus session that was abandoned. Recorded only if >= 1 minute was focused. Never earns XP.
export function abandonedEntry(t, now) {
  if (t.mode !== 'focus' || !t.sid) return null;
  const el = elapsed(t, now);
  if (el < 60000) return null;
  const e = { id: t.sid, t: now, m: 'focus', s: Math.round(el / 1000), c: 0, x: 0 };
  if (t.task) e.k = t.task;
  return e;
}
export function nextAfterComplete(t, settings) {
  if (t.mode !== 'focus') return { mode: 'focus', completed: t.completed };
  const c = t.completed + 1;
  return c >= settings.rounds ? { mode: 'long', completed: 0 } : { mode: 'short', completed: c };
}
// Add (or remove) time to the current session. The session length grows too, so a completed session records
// exactly how long you focused. Never below 1 minute left, never above 180 minutes in total.
export function addTime(t, ms, now) {
  const total = Math.min(180 * 60000, Math.max(60000, t.total + ms)), d = total - t.total;
  if (!d) return t;
  if (t.running) return { ...t, total, endAt: Math.max(now + 60000, t.endAt + d) };
  return { ...t, total, remaining: Math.max(Math.min(60000, total), Math.min(total, t.remaining + d)) };
}
// Wall-clock time the running session ends at (0 when not running).
export const endsAt = t => t.running ? t.endAt : 0;
