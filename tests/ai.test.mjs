// Assistant + parser + validator tests. The assistant runs against a REAL store (Map-backed storage),
// so "recorded" claims are checked against what was actually persisted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, normalize } from '../js/ai/nlu.js';
import { sanitize, validateItems } from '../js/ai/validate.js';
import { createAssistant } from '../js/ai/assistant.js';
import { createServerEngine, isPrivateUrl } from '../js/ai/engines.js';
import { createStore } from '../js/store.js';
import { dkey } from '../js/rpg.js';

const NOW = new Date(2026, 9, 31, 15, 0, 0).getTime();        // Sat 31 Oct 2026, 15:00 local
const TODAY = dkey(NOW), YDAY = dkey(NOW - 864e5);
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
function setup(opts = {}) {
  const storage = mem(), store = createStore(storage);
  const timerCalls = [];
  const timer = { start: t => (timerCalls.push(t), { ok: true, text: 'Started.' }), pause: () => ({ ok: true, text: 'Paused.' }), liveFocusSec: () => 0 };
  let t = NOW;
  const ai = createAssistant({ store, engines: opts.engines || {}, timer, now: () => t, random: () => 0 });
  const persisted = () => JSON.parse(storage.getItem('sl.activities') || '[]');
  return { store, storage, ai, persisted, timerCalls, tick: ms => { t += ms; } };
}
const press = async (ai, r, label) => { const a = r.actions.find(x => x.label === label); assert.ok(a, `button "${label}" in ${JSON.stringify(r.actions.map(x => x.label))}`); return ai.act(a.id); };

/* ---------- logging ---------- */
test('"I did 10 push-ups." is saved and the reply comes from the saved record', async () => {
  const { ai, persisted } = setup();
  const r = await ai.handle('I did 10 push-ups.');
  assert.equal(r.kind, 'saved'); assert.match(r.text, /recorded 10 push-ups for today/);
  const p = persisted(); assert.equal(p.length, 1);
  assert.deepEqual([p[0].name, p[0].qty, p[0].unit, p[0].day, p[0].src, p[0].cat], ['push-ups', 10, 'reps', TODAY, 'chat', 'exercise']);
});
test('20 squats, 15 pages, 2 hours of study, 2 liters of water, 20-minute run', async () => {
  const { ai, persisted } = setup();
  for (const m of ['I did 20 squats', 'I read 15 pages', 'I studied for 2 hours', 'I drank 2 liters of water', 'I ran for 20 minutes']) assert.equal((await ai.handle(m)).kind, 'saved', m);
  assert.deepEqual(persisted().map(a => [a.name, a.qty, a.unit]), [['squats', 20, 'reps'], ['reading', 15, 'pages'], ['study', 120, 'min'], ['water', 2000, 'ml'], ['running', 20, 'min']]);
});
test('several activities in one message become separate records', async () => {
  const { ai, persisted } = setup();
  const r = await ai.handle('I did 20 squats and held a plank for 45 seconds');
  assert.match(r.text, /Recorded for today:\n• 20 squats\n• 45 sec plank/);
  const p = persisted(); assert.equal(p.length, 2); assert.deepEqual(p.map(a => [a.name, a.qty, a.unit]), [['squats', 20, 'reps'], ['plank', 45, 'sec']]);
  assert.notEqual(p[0].id, p[1].id);
});
test('missing quantity: asks, never invents, then saves the answer', async () => {
  const { ai, persisted } = setup();
  const r = await ai.handle('I did some push-ups');
  assert.equal(r.kind, 'question'); assert.equal(r.text, 'How many push-ups did you complete?'); assert.equal(persisted().length, 0);
  const r2 = await ai.handle('15');
  assert.equal(r2.kind, 'saved'); assert.deepEqual(persisted().map(a => a.qty), [15]);
});
test('past dates use the local calendar date ("yesterday", weekday names); future dates are refused', async () => {
  const { ai, persisted } = setup();
  await ai.handle('I did 10 push-ups yesterday');
  assert.equal(persisted()[0].day, YDAY);
  await ai.handle('on monday I read 30 pages');
  assert.equal(persisted()[1].day, '2026-10-26');
  const r = await ai.handle('I will do 10 squats tomorrow');
  assert.equal(r.kind, 'question'); assert.match(r.text, /future/); assert.equal(persisted().length, 2);
});
test('"Actually, I only did 8 push-ups" corrects the last entry instead of adding 8', async () => {
  const { ai, persisted } = setup();
  await ai.handle('I did 10 push-ups');
  const r = await ai.handle('Actually, I only did 8 push-ups');
  assert.equal(r.kind, 'saved'); assert.match(r.text, /Updated: 10 push-ups → 8 push-ups/);
  assert.deepEqual(persisted().map(a => a.qty), [8]);
  const u = await press(ai, r, 'Undo'); assert.match(u.text, /Restored 10 push-ups/); assert.deepEqual(persisted().map(a => a.qty), [10]);
});
test('"I only did 8" without "actually" is ambiguous: asks whether it is a correction or more', async () => {
  const { ai, persisted } = setup();
  await ai.handle('I did 10 push-ups');
  const r = await ai.handle('I only did 8 push-ups');
  assert.equal(r.kind, 'question'); assert.equal(persisted().length, 1);
  await press(ai, r, 'Add 8 more'); assert.deepEqual(persisted().map(a => a.qty), [10, 8]);
});
test('"I completed 3 sessions" asks what kind; Pomodoro sessions need confirmation and earn no XP', async () => {
  const { ai, store } = setup();
  const r = await ai.handle('I completed 3 sessions');
  assert.equal(r.kind, 'question'); assert.match(r.text, /Pomodoro/); assert.equal(store.history.length, 0);
  const r2 = await press(ai, r, 'Pomodoro sessions');
  assert.equal(r2.kind, 'question'); assert.match(r2.text, /Add 3 completed focus sessions of 25 min/);
  const r3 = await press(ai, r2, 'Add sessions');
  assert.match(r3.text, /Added 3 focus sessions \(1 h 15 min\)/);
  assert.equal(store.history.length, 3); assert.ok(store.history.every(h => h.man === 1 && h.x === 0 && h.c === 1));
  await press(ai, r3, 'Undo'); assert.equal(store.history.length, 0);
});
test('unknown activity is only saved as custom after confirmation', async () => {
  const { ai, persisted } = setup();
  const r = await ai.handle('I did 15 kettlebell swings');
  assert.equal(r.kind, 'question'); assert.equal(persisted().length, 0);
  await press(ai, r, 'Save');
  const p = persisted(); assert.equal(p.length, 1); assert.deepEqual([p[0].name, p[0].qty, p[0].unit, p[0].cat], ['kettlebell swings', 15, 'times', 'custom']);
});
test('implausibly large amounts need confirmation', async () => {
  const { ai, persisted } = setup();
  const r = await ai.handle('I did 5000 push-ups');
  assert.equal(r.kind, 'question'); assert.equal(persisted().length, 0);
  await press(ai, r, 'No'); assert.equal(persisted().length, 0);
});
test('glasses of water: asks for the amount instead of guessing a glass size', async () => {
  const { ai, persisted } = setup();
  const r = await ai.handle('I drank 2 glasses of water');
  assert.equal(r.kind, 'question'); assert.match(r.text, /How much was that in total/); assert.equal(persisted().length, 0);
  await ai.handle('500 ml'); assert.deepEqual(persisted().map(a => [a.qty, a.unit]), [[500, 'ml']]);
});
test('duplicate submission asks before logging again', async () => {
  const { ai, persisted, tick } = setup();
  await ai.handle('I did 10 push-ups');
  tick(2000);
  const r = await ai.handle('I did 10 push-ups');
  assert.equal(r.kind, 'question'); assert.match(r.text, /just logged exactly that/); assert.equal(persisted().length, 1);
  await press(ai, r, 'Log again'); assert.equal(persisted().length, 2);
});
test('undo after a successful record removes exactly those records', async () => {
  const { ai, persisted } = setup();
  await ai.handle('I did 5 burpees');
  const r = await ai.handle('I did 20 squats and 30 lunges');
  await press(ai, r, 'Undo');
  assert.deepEqual(persisted().map(a => a.name), ['burpees']);
});
test('deletion always asks first; "Keep" deletes nothing', async () => {
  const { ai, persisted } = setup();
  await ai.handle('I did 20 squats');
  const r = await ai.handle('delete my last squats');
  assert.equal(r.kind, 'question'); assert.equal(persisted().length, 1);
  await press(ai, r, 'Keep'); assert.equal(persisted().length, 1);
  const r2 = await ai.handle('remove that');
  const d = await press(ai, r2, 'Delete'); assert.equal(persisted().length, 0);
  await press(ai, d, 'Undo'); assert.equal(persisted().length, 1);
  assert.match((await ai.handle('delete everything')).text, /won’t delete everything/);
});
test('storage failure: the reply says nothing was recorded, and memory is rolled back', async () => {
  const { ai, store, storage } = setup();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const r = await ai.handle('I did 10 push-ups');
  assert.equal(r.kind, 'error'); assert.match(r.text, /Nothing was recorded/);
  assert.equal(store.activities.length, 0);
});
test('questions are answered from saved records only', async () => {
  const { ai, store } = setup();
  assert.match((await ai.handle('How many push-ups did I do this week?')).text, /No push-ups recorded this week/);
  await ai.handle('I did 10 push-ups'); await ai.handle('I did 15 push-ups yesterday');
  store.addActivities([{ name: 'push-ups', qty: 99, unit: 'reps', day: '2026-10-25' }]);       // Sunday: previous week
  assert.match((await ai.handle('How many push-ups did I do this week?')).text, /This week: 25 push-ups — 2 entries over 2 days/);
  store.addSession({ id: 'f1', t: NOW - 864e5, m: 'focus', s: 1500, c: 1, x: 35 });
  assert.match((await ai.handle('How much time did I spend focusing yesterday?')).text, /You focused 25 min yesterday — 1 completed session/);
  const sum = (await ai.handle('What did I accomplish today?')).text;
  assert.match(sum, /10 push-ups/); assert.doesNotMatch(sum, /15 push-ups/);
  const adv = (await ai.handle('What should I improve tomorrow?')).text;
  assert.match(adv, /What your data shows/); assert.match(adv, /Suggestions \(my recommendations, not data\)/);
});
test('goals and timer commands go through the app, not the model', async () => {
  const { ai, store, timerCalls } = setup();
  assert.match((await ai.handle('set my daily push-up goal to 50')).text, /Daily goal set: 50 push-ups a day/);
  assert.deepEqual(store.goals['push-ups'], { qty: 50, unit: 'reps' });
  assert.match((await ai.handle('I did 50 push-ups')).text, /Push-ups today: 50 \/ 50 — goal reached/);
  await ai.handle('start a 50 minute focus session');
  assert.deepEqual(timerCalls[0], { action: 'start', mode: 'focus', minutes: 50 });
});
test('unknown input saves nothing', async () => {
  const { ai, persisted } = setup();
  const r = await ai.handle('the weather is nice');
  assert.match(r.text, /nothing was saved/); assert.equal(persisted().length, 0);
});

/* ---------- AI model output safety ---------- */
const fakeEngine = out => ({ id: 'server', name: 'Test model', interpret: async () => { if (out instanceof Error) throw out; return typeof out === 'function' ? out() : out; } });
test('an AI model cannot invent a quantity the user never said', async () => {
  const { ai, store, persisted } = setup({ engines: { server: fakeEngine({ intent: 'log', items: [{ activity: 'push-ups', quantity: 25, unit: null }] }) } });
  store.setSettings({ ai: 'server' });
  const r = await ai.handle('I did some push-ups');
  assert.equal(r.kind, 'question'); assert.equal(persisted().length, 0); assert.equal(r.engine, 'server');
});
test('valid model output is validated and saved; invalid output falls back to the built-in parser', async () => {
  const good = setup({ engines: { server: fakeEngine({ intent: 'log', items: [{ activity: 'Push Ups', quantity: '12', unit: 'reps', date: 'yesterday' }], extra: 'ignored' }) } });
  good.store.setSettings({ ai: 'server' });
  await good.ai.handle('I did 12 push ups yesterday');
  assert.deepEqual(good.persisted().map(a => [a.name, a.qty, a.day]), [['push-ups', 12, YDAY]]);
  for (const bad of ['not json', [1, 2], null, new Error('connection refused')]) {
    const s = setup({ engines: { server: fakeEngine(bad) } }); s.store.setSettings({ ai: 'server' });
    const r = await s.ai.handle('I did 10 squats');
    assert.equal(r.kind, 'saved', String(bad)); assert.equal(r.engine, 'rules'); assert.match(r.note, /used built-in parser/);
    assert.deepEqual(s.persisted().map(a => [a.name, a.qty]), [['squats', 10]]);
  }
});
test('sanitize drops unknown fields and coerces types', () => {
  const s = sanitize({ intent: 'hack', items: [{ activity: 'x'.repeat(200), quantity: 'abc', date: '2099-01-01' }], sql: 'DROP' }, NOW);
  assert.equal(s.intent, 'unknown'); assert.equal(s.items[0].activity.length, 60); assert.equal(s.items[0].quantity, null); assert.equal(s.items[0].future, true); assert.equal(s.sql, undefined);
  assert.throws(() => sanitize('text'));
});
test('local server engine speaks Ollama and OpenAI-compatible APIs; private-address check', async () => {
  const calls = [];
  const fakeFetch = async (url, opt) => { calls.push([url, JSON.parse(opt.body)]); return { ok: true, json: async () => url.endsWith('/api/chat') ? { message: { content: '{"intent":"greet"}' } } : { choices: [{ message: { content: 'Sure: {"intent":"thanks"}' } }] } }; };
  let conf = { url: 'http://localhost:11434', api: 'ollama', model: 'qwen2.5:1.5b' };
  const e = createServerEngine(() => conf, fakeFetch);
  assert.deepEqual(await e.interpret('hi', { now: NOW }), { intent: 'greet' });
  assert.equal(calls[0][1].format, 'json'); assert.equal(calls[0][1].model, 'qwen2.5:1.5b');
  conf = { url: 'http://192.168.1.20:1234', api: 'openai', model: 'local' };
  assert.deepEqual(await e.interpret('thanks', { now: NOW }), { intent: 'thanks' });
  assert.ok(calls[1][0].endsWith('/v1/chat/completions'));
  assert.equal(isPrivateUrl('http://localhost:11434'), true); assert.equal(isPrivateUrl('http://192.168.1.4:8080'), true); assert.equal(isPrivateUrl('https://api.example.com'), false);
});

/* ---------- parser details ---------- */
test('parser: number words, sets, mixed units, hours+minutes', () => {
  const it = t => parse(t, { now: NOW }).items.map(i => [i.activity, i.quantity, i.unit]);
  assert.deepEqual(it('twenty five squats'), [['squats', 25, null]]);
  assert.deepEqual(it('3 sets of 10 pushups'), [['push-ups', 30, null]]);
  assert.deepEqual(it('studied for 1 hour and 30 minutes'), [['study', 90, 'min']]);
  assert.deepEqual(it('half an hour of yoga'), [['yoga', 0.5, 'hour']]);
  assert.deepEqual(it('walked 10k steps'), [['walking', 10000, 'steps']]);
  assert.equal(normalize('I did ten push-ups'), 'i did 10 push-ups');
  assert.equal(parse('How many push-ups this week?', { now: NOW }).intent, 'query');
  assert.equal(parse('start a focus session', { now: NOW }).intent, 'timer');
});
test('validator converts units into the activity unit and rejects nonsense', () => {
  const v = validateItems([{ activity: 'plank', quantity: 2, unit: 'minutes' }, { activity: 'push-ups', quantity: 2.5 }, { activity: 'push-ups', quantity: -3 }, { activity: 'water', quantity: 1.5, unit: 'l' }], { now: NOW });
  assert.deepEqual(v.records.map(r => [r.name, r.qty, r.unit]), [['plank', 120, 'sec'], ['water', 1500, 'ml']]);
  assert.equal(v.issues.length, 2);
});
