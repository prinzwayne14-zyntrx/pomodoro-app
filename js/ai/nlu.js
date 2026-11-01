// Built-in natural-language understanding. Deterministic, offline, instant.
// Turns a chat message into an Interpretation (the same shape an LLM engine must return):
//
// { v: 1, intent: 'log'|'correct'|'delete'|'query'|'timer'|'goal'|'greet'|'thanks'|'help'|'unknown',
//   items:  [{ activity, quantity, unit, date, custom?, vague?, ambiguous?, note? }],   // log / correct / delete
//   query:  { metric, activity, range },                                                // query
//   timer:  { action, mode, minutes },                                                  // timer
//   goal:   { target, quantity, unit },                                                 // goal
//   target: 'last' | null }                                                             // delete / correct
//
// Nothing here writes data. The validator (validate.js) decides what is safe to save.
import { findActivities, unitOf, UNIT_PATTERN } from '../catalog.js';
import { dkey, dayNum } from '../rpg.js';

/* ---------- numbers ---------- */
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMWORD = `(?:${[...Object.keys(ONES), ...Object.keys(TENS), 'hundred', 'thousand'].join('|')})`;
function wordsToNumber(str) {
  let total = 0, cur = 0;
  for (const w of str.split(/[\s-]+/)) {
    if (w === 'and' || w === 'a') { if (w === 'a') cur = cur || 1; continue; }
    if (w in ONES) cur += ONES[w]; else if (w in TENS) cur += TENS[w];
    else if (w === 'hundred') cur = (cur || 1) * 100; else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; }
  }
  return total + cur;
}
const VAGUE = /\b(some|a few|few|several|a bunch of|bunch of|a lot of|lots of|loads of|many|a couple of|a couple|couple of|a bit of|a little)\b/;

/** Normalize text: lower case, number words -> digits, "half an hour" -> "0.5 hour", "3 sets of 10" -> "30" … */
export function normalize(text) {
  let s = ' ' + String(text || '').toLowerCase().replace(/[’`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim() + ' ';
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2')                                   // 1,000 -> 1000
       .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')                                // 1,5 -> 1.5
       .replace(/\bhalf a dozen\b/g, '6').replace(/\ba dozen\b/g, '12').replace(/\bdozen\b/g, '12')
       .replace(/\b(an?|one) (hour|minute|liter|litre|mile|kilometer|kilometre|km|page|session|rep) and a half\b/g, '1.5 $2')
       .replace(/\b(\d+(?:\.\d+)?) and a half (hours?|minutes?|lit(?:er|re)s?|miles?|km|kilomet(?:er|re)s?)\b/g, (m, n, u) => `${+n + .5} ${u}`)
       .replace(/\bhalf (an?|one) (hour|minute|liter|litre|mile|kilometer|kilometre|km)\b/g, '0.5 $2')
       .replace(/\ba quarter of an? hour\b/g, '15 minutes')
       .replace(/\b(an?) (hour|minute|second|liter|litre|mile|kilometer|kilometre|km|page)\b/g, '1 $2');
  // number words: "twenty five", "one hundred and twenty", "fifteen"
  s = s.replace(new RegExp(`\\b${NUMWORD}(?:[\\s-]+(?:and[\\s-]+)?${NUMWORD})*\\b`, 'g'), m => String(wordsToNumber(m)));
  s = s.replace(/(\d+(?:\.\d+)?) and a half (hours?|minutes?|lit(?:er|re)s?|miles?|km|kilomet(?:er|re)s?)\b/g, (m, n, u) => `${+n + .5} ${u}`);
  s = s.replace(/\b(\d+)h(\d+)\b/g, '$1 hours $2 minutes')                      // 1h30
       .replace(/\b(\d+(?:\.\d+)?)\s*k\s+steps\b/g, (m, n) => `${Math.round(+n * 1000)} steps`)   // 10k steps
       .replace(/(\d)\s*-\s*(second|minute|hour|page|km|mile|rep)/g, '$1 $2')  // 45-second
       .replace(/(\d)(?=[a-z])/g, '$1 ');                                       // 20min, 2l, 45s
  // sets: "3 sets of 10 push-ups", "3x10 push-ups", "3 x 10"
  s = s.replace(/\b(\d+) (?:sets? of|x|×|\*) ?(\d+)\b/g, (m, a, b) => `${+a * +b} `);
  return s.replace(/\s+/g, ' ').trim();
}

/** All quantities in a (normalized) string: [{value, unitWord, index, end}] */
export function quantities(s) {
  const re = new RegExp(`(\\d+(?:\\.\\d+)?)(?:\\s*(${UNIT_PATTERN}))?(?![a-z0-9])`, 'g'), out = [];
  let m;
  while ((m = re.exec(s))) out.push({ value: parseFloat(m[1]), unitWord: m[2] || null, index: m.index, end: m.index + m[0].length });
  return out;
}
/** Numbers present in raw user text (used to stop an AI model from inventing quantities). */
export function numbersIn(text) {
  const s = normalize(text), set = new Set();
  for (const q of quantities(s)) { set.add(q.value); const u = unitOf(q.unitWord); if (u && u.factor) set.add(Math.round(q.value * u.factor * 1000) / 1000); }
  for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) set.add(parseFloat(m[0]));
  return set;
}

/* ---------- dates ---------- */
const WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const keyAdd = (now, n) => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return dkey(d.getTime()); };
/** Resolve a date phrase in local time. Returns {key} | {future: true, key} | null (no date mentioned). */
export function findDate(s, now = Date.now()) {
  let m;
  if (/\b(tomorrow|next week)\b/.test(s)) return { future: true, key: keyAdd(now, 1) };
  if (/\bday before yesterday\b/.test(s)) return { key: keyAdd(now, -2), phrase: 'the day before yesterday' };
  if (/\b(yesterday|last night)\b/.test(s)) return { key: keyAdd(now, -1), phrase: 'yesterday' };
  if ((m = /\b(\d+) days? ago\b/.exec(s))) return { key: keyAdd(now, -+m[1]), phrase: `${m[1]} days ago` };
  if (/\b(today|this morning|this afternoon|this evening|tonight|earlier|just now|so far)\b/.test(s)) return { key: dkey(now), phrase: 'today' };
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s))) { const k = `${m[1]}-${m[2]}-${m[3]}`; return dayNum(k) > dayNum(dkey(now)) ? { future: true, key: k } : { key: k, phrase: k }; }
  const mon = `(${MONTHS.join('|')})[a-z]*\\.?`;
  if ((m = new RegExp(`\\b${mon} (\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(s)) || (m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${mon}`).exec(s))) {
    const [mo, d] = isNaN(+m[1]) ? [MONTHS.indexOf(m[1].slice(0, 3)), +m[2]] : [MONTHS.indexOf(m[2].slice(0, 3)), +m[1]];
    const y = new Date(now).getFullYear(); let dt = new Date(y, mo, d, 12);
    if (dt.getMonth() !== mo) return null;
    if (dkey(dt.getTime()) > dkey(now)) dt = new Date(y - 1, mo, d, 12);
    return { key: dkey(dt.getTime()), phrase: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
  }
  if ((m = new RegExp(`\\b(last |on |this past )?(${WD.join('|')})\\b`).exec(s))) {
    const want = WD.indexOf(m[2]), today = new Date(now).getDay();
    let back = (today - want + 7) % 7; if (back === 0 && m[1] === 'last ') back = 7;
    return { key: keyAdd(now, -back), phrase: back === 0 ? 'today' : m[2].charAt(0).toUpperCase() + m[2].slice(1) };
  }
  return null;
}

/* ---------- ranges for questions ---------- */
export function findRange(s) {
  if (/\byesterday\b/.test(s)) return 'yesterday';
  if (/\blast week\b/.test(s)) return 'last_week';
  if (/\b(last|past) (7|seven) days\b|\bthis past week\b/.test(s)) return 'last_7';
  if (/\b(last|past) (30|thirty) days\b/.test(s)) return 'last_30';
  if (/\blast month\b/.test(s)) return 'last_month';
  if (/\b(this|current) week\b|\bweekly\b|\bthis wk\b/.test(s)) return 'this_week';
  if (/\b(this|current) month\b|\bmonthly\b/.test(s)) return 'this_month';
  if (/\b(all time|ever|in total|overall|total)\b/.test(s)) return 'all';
  if (/\btoday\b|\bso far\b/.test(s)) return 'today';
  return null;
}

/* ---------- intent detection ---------- */
const RX = {
  question: /^(what|what's|whats|how|when|which|who|where|why|did i|do i|am i|have i|was i|were|is my|are my|show|tell|give me|list|summar|recap|report|can you (show|tell|give))\b|\?\s*$/,
  del: /\b(delete|remove|erase|undo)\b|\bcancel (that|it|the last|my last)\b/,
  correct: /\b(actually|correction|i meant|i mean|meant to say|should (have )?be(en)?|make (it|that)|change (it|that|the last|my last)|not \d+(?:\.\d+)?,? but|instead)\b/,
  goal: /\b(goal|target)\b/,
  goalSet: /\b(set|change|make|update|increase|decrease|raise|lower|put|is|to)\b/,
  timer: /^(please |can you |could you |zyn,? )?(start|begin|pause|resume|continue|stop|reset|restart|skip|take)\b/,
  timerObj: /\b(timer|session|focus|pomodoro|break|clock)\b|\b\d+ ?(min|minute)/,
  greet: /^(hi|hello|hey|yo|hiya|howdy|good (morning|afternoon|evening|night)|sup|what'?s up)\b/,
  thanks: /\b(thanks|thank you|thx|ty|cheers|appreciate it)\b/,
  help: /\b(help|what can you do|how do i use|commands|examples?)\b/,
  logVerb: /\b(i|i've|ive|just)\b.*\b(did|done|completed|finished|made|performed|hit|knocked out|got in|managed)\b|^(log|add|record|track|note)\b/
};
const NOT_ACTIVITIES = /^(things?|stuff|it|that|this|them|work|tasks?|something|nothing|everything|my best|well|good|great|bad|ok|okay|fine|sessions?)$/;

/** Parse a message. ctx: { now } */
export function parse(text, ctx = {}) {
  const now = ctx.now || Date.now(), raw = String(text || '').trim(), s = normalize(raw);
  const base = { v: 1, intent: 'unknown', items: [], query: null, timer: null, goal: null, target: null };
  if (!s) return base;
  const acts = findActivities(s), isQ = RX.question.test(s);

  if (RX.del.test(s) && !isQ) return { ...base, intent: 'delete', target: /\b(all|everything)\b/.test(s) ? 'all' : 'last', items: acts.map(a => ({ activity: a.activity.name, quantity: null, unit: null, date: (findDate(s, now) || {}).key || null })) };
  if (RX.goal.test(s) && !isQ && RX.goalSet.test(s) && quantities(s).length) return { ...base, intent: 'goal', goal: parseGoal(s, acts) };
  if (RX.timer.test(s) && RX.timerObj.test(s) && !isQ) return { ...base, intent: 'timer', timer: parseTimer(s) };
  if (isQ) return { ...base, intent: 'query', query: parseQuery(s, acts) };
  if (RX.correct.test(s) && (acts.length || quantities(s).length)) return { ...base, intent: 'correct', target: 'last', items: parseItems(s, now) };

  const items = parseItems(s, now);
  if (items.length) return { ...base, intent: 'log', items };
  if (RX.thanks.test(s)) return { ...base, intent: 'thanks' };
  if (RX.greet.test(s)) return { ...base, intent: 'greet' };
  if (RX.help.test(s)) return { ...base, intent: 'help' };
  return base;
}

function parseItems(s, now) {
  const clauses = s.split(/\s*(?:,|;|\.(?=\s|$)|!|\band then\b|\bthen\b|\band also\b|\band\b|\bplus\b|&|\balso\b)\s*/).filter(Boolean);
  const items = []; let lastAct = null, lastDate = null, carryDate = null;
  const msgDate = findDate(s, now);
  for (const c of clauses) {
    const date = findDate(c, now) || null, acts = findActivities(c), qs = quantities(c).filter(q => !isDateNumber(c, q));
    const dateKey = date ? date : carryDate || null;
    if (!acts.length && !qs.length) { if (date) carryDate = date; continue; }
    if (!acts.length) {                                                // "… and 30 minutes", "… and 20 today"
      const custom = customFrom(c, qs);
      if (custom) { items.push({ ...custom, date: (dateKey || msgDate || {}).key || null, future: !!(dateKey || msgDate || {}).future }); continue; }
      if (/\bsessions?\b/.test(c) && qs.length) { items.push({ activity: null, ambiguous: 'sessions', quantity: qs[0].value, unit: 'sessions', date: (dateKey || msgDate || {}).key || null }); continue; }
      if (!lastAct) continue;
      const prev = items[items.length - 1], u = unitOf(qs[0].unitWord);
      if (prev && prev.activity === lastAct && !date && u && prev.unit && unitOf(prev.unit) && unitOf(prev.unit).unit === 'min' && u.unit === 'min') { prev.quantity = toMin(prev) + qs[0].value * u.factor; prev.unit = 'min'; continue; }
      items.push({ activity: lastAct, quantity: qs[0].value, unit: qs[0].unitWord, date: (date || lastDate || msgDate || {}).key || null, future: !!(date || lastDate || msgDate || {}).future });
      continue;
    }
    // assign each quantity to the nearest activity (ties go to the following one: "10 push-ups 20 squats")
    const per = acts.map(() => []);
    for (const q of qs) {
      let best = 0, bd = Infinity;
      acts.forEach((a, i) => { const d = q.end <= a.index ? a.index - q.end : q.index >= a.end ? q.index - a.end + .5 : 0; if (d < bd) { bd = d; best = i; } });
      per[best].push(q);
    }
    acts.forEach((a, i) => {
      const item = combine(a.activity, per[i], c);
      const d = date || lastDate || msgDate;
      item.date = d ? d.key : null; if (d && d.future) item.future = true;
      if (VAGUE.test(c) && item.quantity == null) item.vague = true;
      if (a.activity.name === 'pomodoro' || !/\bsessions?\b/.test(c) || /pomodoro|focus/.test(c)) items.push(item);
      else items.push({ ...item, activity: null, ambiguous: 'sessions' });
      lastAct = a.activity.name;
    });
    if (date) lastDate = date;
  }
  return items;
}
const isDateNumber = (c, q) => new RegExp(`\\b${q.value} days? ago\\b`).test(c) || /\d{4}-\d{2}-\d{2}/.test(c.slice(Math.max(0, q.index - 8), q.end + 6)) ||
  new RegExp(`\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.? ${q.value}\\b|\\b${q.value}(st|nd|rd|th)\\b`).test(c);
const toMin = it => { const u = unitOf(it.unit); return u && u.unit === 'min' ? it.quantity * u.factor : it.quantity; };

// several quantities for one activity: sum durations ("1 hour 30 minutes"), keep a second measure as a note ("5 km in 30 min")
function combine(act, qs, clause) {
  if (!qs.length) return { activity: act.name, quantity: null, unit: null };
  const withUnit = qs.map(q => ({ q, u: unitOf(q.unitWord) }));
  const time = withUnit.filter(x => x.u && x.u.unit === 'min');
  if (time.length > 1) return { activity: act.name, quantity: time.reduce((a, x) => a + x.q.value * x.u.factor, 0), unit: 'min' };
  const canon = x => x.u && (x.u.unit === 'min' && act.units.includes('sec') ? 'sec' : x.u.unit);
  let pref = null; for (const u of act.units) { pref = withUnit.find(x => canon(x) === u); if (pref) break; }
  pref = pref || withUnit.find(x => !x.u) || withUnit[0];
  const others = withUnit.filter(x => x !== pref && x.u);
  const item = { activity: act.name, quantity: pref.q.value, unit: pref.q.unitWord };
  if (others.length) item.note = others.map(x => `${x.q.value} ${x.q.unitWord}`).join(', ');
  return item;
}

// unknown activity: "I did 15 kettlebell swings", "20 minutes of guitar practice"
function customFrom(c, qs) {
  let m = /\b(?:did|completed|finished|made|performed|practiced|practised|logged|log|add|record)\s+(\d+(?:\.\d+)?)\s+(?!(?:minutes?|mins?|hours?|hrs?|seconds?|secs?)\b)([a-z][a-z' -]{1,28}?)\s*(?:today|yesterday|this morning|tonight|this evening)?$/.exec(c);
  if (m && !NOT_ACTIVITIES.test(m[2].trim()) && !/\bsessions?\b/.test(m[2])) return { activity: m[2].trim(), custom: true, quantity: +m[1], unit: null };
  m = /(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h)\s+(?:of\s+)([a-z][a-z' -]{1,28}?)\s*(?:today|yesterday|this morning|tonight)?$/.exec(c)
    || /\b(?:did|practiced|practised|played|spent)\s+(?:the\s+)?([a-z][a-z' -]{1,24}?)\s+for\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h)\b/.exec(c);
  if (m) {
    const [q, u, name] = isNaN(+m[1]) ? [+m[2], m[3], m[1]] : [+m[1], m[2], m[3]];
    if (!NOT_ACTIVITIES.test(name.trim())) return { activity: name.trim(), custom: true, quantity: q, unit: u };
  }
  return null;
}

function parseGoal(s, acts) {
  const q = quantities(s)[0];
  if (/\b(focus|pomodoro|sessions?)\b/.test(s) && !acts.some(a => a.activity.name !== 'pomodoro')) return { target: 'focus', quantity: q.value, unit: 'sessions' };
  return { target: acts[0] ? acts[0].activity.name : null, quantity: q.value, unit: q.unitWord };
}

function parseTimer(s) {
  const q = quantities(s).find(x => { const u = unitOf(x.unitWord); return u && u.unit === 'min'; });
  const minutes = q ? q.value * unitOf(q.unitWord).factor : null;
  const mode = /\blong break\b/.test(s) ? 'long' : /\b(short )?break\b/.test(s) ? 'short' : 'focus';
  const action = /\b(pause|stop)\b/.test(s) ? 'pause' : /\b(resume|continue)\b/.test(s) ? 'resume' : /\b(reset|restart)\b/.test(s) ? 'reset' : /\bskip\b/.test(s) ? 'skip' : 'start';
  return { action, mode, minutes };
}

function parseQuery(s, acts) {
  const range = findRange(s), act = acts.find(a => a.activity.name !== 'pomodoro');
  const q = (metric, def, extra = {}) => ({ metric, activity: null, range: range || def, ...extra });
  if (/\b(improve|suggest|suggestion|advice|tips?|better|should i|recommend)\b/.test(s)) return q('advice', 'last_7');
  if (/\bstreak\b/.test(s)) return q('streak', 'all');
  if (/\b(goals?|consistent|consistency|on track)\b/.test(s)) return q('goals', 'last_7');
  if (/\b(level|xp|rank|experience)\b/.test(s)) return q('level', 'all');
  if (/\b(zyn|wolf|evolve|evolution|stage)\b/.test(s)) return q('evolution', 'all');
  if (/\bhow many days\b.*\b(exercise|exercised|work(ed)? out|train(ed)?|move(d)?)\b/.test(s)) return q('exercise_days', 'this_month');
  if (act && /\b(how (many|much|long|far)|total|count|number)\b/.test(s)) return q('activity', 'today', { activity: act.activity.name });
  if (/\b(focus|focused|focusing|pomodoro|pomodoros|sessions?)\b/.test(s)) {
    if (/\b(how (much|long)|time|hours?|minutes?)\b/.test(s) && !/\bhow many\b/.test(s)) return q('focus_time', 'today');
    return q('focus_sessions', 'today');
  }
  if (/\b(progress|trend|overview|last (7|seven) days|chart|graph)\b/.test(s)) return q('progress', 'last_7');
  if (act) return q('activity', 'today', { activity: act.activity.name });
  if (/\b(accomplish|achieve|get done|did i do|have i done|summary|summar|recap|productive|productivity|how am i doing|how did i do|report)\b/.test(s)) return q('summary', 'today');
  if (/\b(exercise|exercised|workout|work out|worked out)\b/.test(s)) return q('exercise_days', 'this_week');
  if (/\btasks?\b/.test(s)) return q('tasks', 'today');
  return q('summary', 'today');
}
