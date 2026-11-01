// Activity catalog: the single definition of what ZENTRY can record.
// Used by the parser, the validator, the store and the statistics, so names and units never drift apart.
// Pure module: no DOM, no storage.

/* Canonical units. Every saved record uses one of these. */
export const UNITS = {
  reps:     { kind: 'count',    one: 'rep',     many: 'reps' },
  sec:      { kind: 'time',     one: 'second',  many: 'seconds' },
  min:      { kind: 'time',     one: 'minute',  many: 'minutes' },
  pages:    { kind: 'count',    one: 'page',    many: 'pages' },
  ml:       { kind: 'volume',   one: 'ml',      many: 'ml' },
  km:       { kind: 'distance', one: 'km',      many: 'km' },
  steps:    { kind: 'count',    one: 'step',    many: 'steps' },
  times:    { kind: 'count',    one: 'time',    many: 'times' },
  sessions: { kind: 'count',    one: 'session', many: 'sessions' }
};

/* Categories drive grouping in statistics ("exercise days" = days with any exercise record). */
export const CATEGORIES = ['exercise', 'study', 'reading', 'mind', 'hydration', 'health', 'focus', 'custom'];

/* Supported activities.
   units:   allowed canonical units (first = preferred)
   bare:    unit used when the user gives a number without a unit ("10 push-ups" -> reps). Absent = must ask.
   max:     per-entry sanity limit per unit; above it the assistant asks for confirmation instead of saving. */
export const ACTIVITIES = [
  { name: 'push-ups', label: 'Push-ups', cat: 'exercise', units: ['reps'], bare: 'reps', aliases: ['push-ups', 'push ups', 'pushups', 'push-up', 'push up', 'pushup', 'press-ups', 'press ups', 'pressups'] },
  { name: 'squats', label: 'Squats', cat: 'exercise', units: ['reps'], bare: 'reps', aliases: ['squats', 'squat'] },
  { name: 'sit-ups', label: 'Sit-ups', cat: 'exercise', units: ['reps'], bare: 'reps', aliases: ['sit-ups', 'sit ups', 'situps', 'sit-up', 'sit up', 'situp'] },
  { name: 'crunches', label: 'Crunches', cat: 'exercise', units: ['reps'], bare: 'reps', aliases: ['crunches', 'crunch'] },
  { name: 'pull-ups', label: 'Pull-ups', cat: 'exercise', units: ['reps'], bare: 'reps', aliases: ['pull-ups', 'pull ups', 'pullups', 'pull-up', 'pull up', 'pullup', 'chin-ups', 'chin ups', 'chinups'] },
  { name: 'lunges', label: 'Lunges', cat: 'exercise', units: ['reps'], bare: 'reps', aliases: ['lunges', 'lunge'] },
  { name: 'burpees', label: 'Burpees', cat: 'exercise', units: ['reps'], bare: 'reps', aliases: ['burpees', 'burpee'] },
  { name: 'jumping jacks', label: 'Jumping jacks', cat: 'exercise', units: ['reps'], bare: 'reps', aliases: ['jumping jacks', 'jumping jack', 'star jumps'] },
  { name: 'dips', label: 'Dips', cat: 'exercise', units: ['reps'], bare: 'reps', aliases: ['dips', 'tricep dips', 'triceps dips'] },
  { name: 'plank', label: 'Plank', cat: 'exercise', units: ['sec'], aliases: ['plank', 'planks', 'planked', 'planking'] },
  { name: 'running', label: 'Running', cat: 'exercise', units: ['min', 'km'], aliases: ['running', 'run', 'ran', 'jogging', 'jogged', 'jog', 'runs'] },
  { name: 'walking', label: 'Walking', cat: 'exercise', units: ['min', 'km', 'steps'], aliases: ['walking', 'walked', 'walk', 'steps'] },
  { name: 'cycling', label: 'Cycling', cat: 'exercise', units: ['min', 'km'], aliases: ['cycling', 'cycled', 'biked', 'biking', 'bike ride', 'bike'] },
  { name: 'swimming', label: 'Swimming', cat: 'exercise', units: ['min', 'km'], aliases: ['swimming', 'swam', 'swim'] },
  { name: 'yoga', label: 'Yoga', cat: 'exercise', units: ['min'], aliases: ['yoga'] },
  { name: 'stretching', label: 'Stretching', cat: 'exercise', units: ['min'], aliases: ['stretching', 'stretched', 'stretch', 'stretches'] },
  { name: 'workout', label: 'Workout', cat: 'exercise', units: ['min'], aliases: ['workout', 'worked out', 'work out', 'working out', 'gym', 'training session', 'exercised', 'exercising', 'exercise'] },
  { name: 'study', label: 'Study', cat: 'study', units: ['min'], aliases: ['studied', 'studying', 'study', 'revised', 'revising', 'revision', 'homework'] },
  { name: 'reading', label: 'Reading', cat: 'reading', units: ['pages', 'min'], aliases: ['reading', 'read', 'pages'] },
  { name: 'meditation', label: 'Meditation', cat: 'mind', units: ['min'], aliases: ['meditated', 'meditation', 'meditating', 'meditate'] },
  { name: 'journaling', label: 'Journaling', cat: 'mind', units: ['times', 'min'], bare: 'times', aliases: ['journaled', 'journalled', 'journaling', 'journalling', 'journal'] },
  { name: 'water', label: 'Water', cat: 'hydration', units: ['ml'], aliases: ['water', 'drank', 'drink', 'drinking', 'hydrated'] },
  { name: 'sleep', label: 'Sleep', cat: 'health', units: ['min'], aliases: ['slept', 'sleep', 'sleeping'] },
  // manual focus sessions: recorded into the focus history (not as an activity) after explicit confirmation
  { name: 'pomodoro', label: 'Pomodoro sessions', cat: 'focus', units: ['sessions'], bare: 'sessions', aliases: ['pomodoro sessions', 'pomodoro session', 'pomodoros', 'pomodoro', 'focus sessions', 'focus session'] }
];

export const LIMITS = { reps: 1000, sec: 3600, min: 720, pages: 1500, ml: 8000, km: 250, steps: 80000, times: 50, sessions: 30 };
export const HARD_MAX = { reps: 100000, sec: 86400, min: 1440, pages: 100000, ml: 50000, km: 2000, steps: 1000000, times: 1000, sessions: 100 };

const BY_NAME = new Map(ACTIVITIES.map(a => [a.name, a]));
export const activity = name => BY_NAME.get(name) || null;
export const labelOf = name => (BY_NAME.get(name) || {}).label || cap(name);
export const catOf = name => (BY_NAME.get(name) || {}).cat || 'custom';
export const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// alias -> activity, longest alias first so "push ups" wins over "push"
const ALIASES = ACTIVITIES.flatMap(a => a.aliases.map(al => [al, a])).sort((x, y) => y[0].length - x[0].length);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ -]/g, '[ -]?');
const ALIAS_RE = ALIASES.map(([al, a]) => [new RegExp(`(^|[^a-z])${esc(al)}(?![a-z])`, 'i'), a, al]);
/** Find catalog activities mentioned in text. Returns [{activity, index, alias}] in order of appearance (no overlaps). */
export function findActivities(text) {
  const out = [], taken = [];
  for (const [re, a, al] of ALIAS_RE) {
    const m = re.exec(text); if (!m) continue;
    const start = m.index + m[1].length, end = start + m[0].length - m[1].length;
    if (taken.some(([s, e]) => start < e && s < end)) continue;
    taken.push([start, end]);
    const same = out.find(o => o.activity === a);            // "read … pages", "drank … water": one activity, wider span
    if (same) { same.index = Math.min(same.index, start); same.end = Math.max(same.end, end); continue; }
    out.push({ activity: a, index: start, end, alias: al });
  }
  return out.sort((x, y) => x.index - y.index);
}
/** Resolve a name an AI model proposed ("Push Ups", "pushups") to a catalog activity, or null. */
export function resolveActivity(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  if (BY_NAME.has(n)) return BY_NAME.get(n);
  const hit = findActivities(n)[0];
  return hit && hit.end - hit.index >= n.replace(/^(the|a|some)\s+/, '').length - 2 ? hit.activity : null;
}

/* ---------- units ---------- */
// spoken/written unit -> [canonical unit, factor] ; null factor = needs clarification (e.g. "glasses")
const UNIT_WORDS = [
  [/^(reps?|repetitions?|times?|x)$/, 'reps', 1],
  [/^(s|secs?|seconds?)$/, 'sec', 1],
  [/^(m|mins?|minutes?)$/, 'min', 1],
  [/^(h|hrs?|hours?)$/, 'min', 60],
  [/^(pages?|pg|pgs)$/, 'pages', 1],
  [/^(ml|millilit(er|re)s?)$/, 'ml', 1],
  [/^(l|lit(er|re)s?|ltrs?)$/, 'ml', 1000],
  [/^(km|kms|kilomet(er|re)s?|k)$/, 'km', 1],
  [/^(mi|miles?)$/, 'km', 1.609344],
  [/^(meters?|metres?)$/, 'km', .001],
  [/^steps?$/, 'steps', 1],
  [/^sessions?$/, 'sessions', 1],
  [/^(glass(es)?|cups?|bottles?|mugs?)$/, 'vessel', null]
];
/** Normalize a unit word. Returns {unit, factor} or null when unknown. */
export function unitOf(word) {
  if (!word) return null;
  const w = String(word).toLowerCase().trim().replace(/\.$/, '');
  for (const [re, unit, factor] of UNIT_WORDS) if (re.test(w)) return { unit, factor };
  if (UNITS[w]) return { unit: w, factor: 1 };
  return null;
}
export const UNIT_PATTERN = '(?:repetitions?|reps?|times|seconds?|secs?|minutes?|mins?|hours?|hrs?|pages?|pgs?|millilit(?:er|re)s?|ml|lit(?:er|re)s?|ltrs?|l|kilomet(?:er|re)s?|kms?|km|k|miles?|mi|meters?|metres?|steps?|sessions?|glass(?:es)?|cups?|bottles?|mugs?|h|m|s|x)';

/** Convert value in a canonical unit to the activity's allowed unit (e.g. plank 1 min -> 60 sec). */
export function fitUnit(act, qty, unit) {
  if (!act) return { qty, unit };
  if (act.units.includes(unit)) return { qty, unit };
  if (unit === 'min' && act.units.includes('sec')) return { qty: qty * 60, unit: 'sec' };
  if (unit === 'sec' && act.units.includes('min')) return { qty: qty / 60, unit: 'min' };
  if (unit === 'reps' && act.units.includes('times')) return { qty, unit: 'times' };
  if (unit === 'times' && act.units.includes('reps')) return { qty, unit: 'reps' };
  return null;                                                       // not a valid unit for this activity
}

/** "10 push-ups", "45-second plank", "2,000 ml water", "30 min study" */
export function fmtQty(qty, unit, name) {
  const n = Math.round(qty * 100) / 100, u = UNITS[unit];
  if (unit === 'sec' && qty >= 120 && qty % 60 === 0) return fmtQty(qty / 60, 'min', name);
  if (unit === 'min' && qty >= 60) { const h = Math.floor(qty / 60), m = Math.round(qty % 60); return `${h} h${m ? ' ' + m + ' min' : ''}${name ? ' ' + name : ''}`; }
  if (unit === 'ml' && qty >= 1000) return `${(Math.round(qty / 10) / 100).toLocaleString('en-US')} L${name ? ' ' + name : ''}`;
  const num = n.toLocaleString('en-US');
  const unitTxt = unit === 'reps' ? '' : unit === 'sec' ? ' sec' : unit === 'min' ? ' min' : ' ' + (n === 1 ? u.one : u.many);
  return `${num}${unitTxt}${name ? ' ' + name : ''}`.replace(/\s+/g, ' ').trim();
}
/** Human description of one record, e.g. "10 push-ups", "45 sec plank", "30 min of study". */
export function describe(rec) {
  const a = activity(rec.name), lbl = (a ? a.label : rec.label || rec.name).toLowerCase();
  if (rec.unit === 'reps' || rec.unit === 'times' && a && a.bare === 'times') return `${fmtQty(rec.qty, rec.unit)} ${lbl}`.replace(/ times journaling$/, ' journal entries');
  if (rec.unit === 'pages') return `${fmtQty(rec.qty, 'pages')} read`;
  if (rec.unit === 'ml') return `${fmtQty(rec.qty, 'ml')} of water`.replace(/of water of water/, 'of water');
  if (rec.unit === 'steps') return `${fmtQty(rec.qty, 'steps')}`;
  if (rec.unit === 'km') return `${fmtQty(rec.qty, 'km')} ${lbl}`;
  if (rec.unit === 'sec' || rec.unit === 'min') return `${fmtQty(rec.qty, rec.unit)} ${rec.name === 'plank' ? 'plank' : ['study', 'sleep', 'meditation', 'yoga', 'reading', 'journaling'].includes(rec.name) ? 'of ' + lbl : lbl}`;
  return `${fmtQty(rec.qty, rec.unit)} ${lbl}`;
}
