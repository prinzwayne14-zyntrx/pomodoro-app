// Browser end-to-end tests (Chromium via Playwright). Needs `playwright` installed and python3.
// Run:  node tests/e2e.mjs        Screenshots go to $SHOTS (default ./tests/shots)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS || path.join(ROOT, 'tests', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const serve = (dir, port) => new Promise(res => { const p = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' }); setTimeout(() => res(p), 700); });
const results = []; let failures = 0;
const test = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { failures++; results.push(['FAIL', name + ' -> ' + (e.message || e).toString().split('\n')[0]]); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const srv = await serve(ROOT, 8123);
const URL_ = 'http://127.0.0.1:8123/index.html';
const browser = await chromium.launch();
const newCtx = (vp = { width: 390, height: 844 }, opts = {}) => browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: vp.width < 700, hasTouch: vp.width < 700, ...opts });
const get = (p, k) => p.evaluate(k => JSON.parse(localStorage.getItem(k)), k);
const set = (p, k, v) => p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [k, v]);
const T = (o = {}) => ({ mode: 'focus', running: false, endAt: 0, remaining: 1500000, total: 1500000, sid: null, completed: 0, task: null, ...o });
async function fresh(ctx, seed = {}) {
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/vibrate/.test(m.text())) p.errs.push(m.text()); });
  await p.goto(URL_);
  await p.evaluate(() => localStorage.clear());
  for (const [k, v] of Object.entries(seed)) await set(p, k, v);
  await p.reload(); await p.waitForSelector('#clock');
  return p;
}
const goto = (p, v) => p.click(`nav button[data-view=${v}]`);
const now = () => Date.now();
const dbtn = (p, name) => p.locator('#dlgBox').getByRole('button', { name, exact: true }).click();

/* ---------- boot & timer ---------- */
const ctx = await newCtx();
await test('boots with no errors and creates versioned storage', async () => {
  const p = await fresh(ctx);
  eq(await p.title(), 'Solo Leveling'); eq(await p.textContent('#clock'), '25:00');
  ok(await p.evaluate(() => !!localStorage.getItem('sl.meta')), 'meta key'); eq(p.errs, []);
  await p.close();
});
await test('timer counts down by wall-clock time and survives a refresh', async () => {
  const p = await fresh(ctx, { 'sl.timer': T({ running: true, endAt: now() + 90000, sid: 's-run' }) });
  const txt = await p.textContent('#clock'); ok(['01:30', '01:29', '01:28'].includes(txt), 'got ' + txt);
  eq(await p.textContent('#toggleText'), 'Pause');
  await p.waitForTimeout(2100); await p.reload(); await p.waitForSelector('#clock');
  const t2 = await p.textContent('#clock'); ok(['01:27', '01:26', '01:25', '01:28'].includes(t2), 'after reload ' + t2);
  eq(await p.textContent('#toggleText'), 'Pause'); await p.close();
});
await test('pause keeps the remaining time; resume continues', async () => {
  const p = await fresh(ctx);
  await p.click('#toggle'); await p.waitForTimeout(1300); await p.click('#toggle');
  const a = await p.textContent('#clock'); await p.waitForTimeout(1500);
  eq(await p.textContent('#clock'), a, 'paused clock moved'); eq(await p.textContent('#toggleText'), 'Resume');
  const st = await get(p, 'sl.timer'); eq(st.running, false); await p.close();
});
await test('session that finished while the app was closed is recorded once, with correct XP', async () => {
  const p = await fresh(ctx, { 'sl.timer': T({ running: true, endAt: now() - 30000, sid: 'away-1' }) });
  await p.waitForTimeout(500);
  let h = await get(p, 'sl.history'); eq(h.length, 1); eq(h[0].id, 'away-1'); eq(h[0].x, 35); eq(h[0].c, 1); eq(h[0].s, 1500);
  eq(await p.textContent('#lvNum'), '1'); eq(await p.textContent('#xpNum'), '35 / 100 XP');
  eq(await p.textContent('#label'), 'Short break');                            // moved on to the break
  await p.reload(); await p.waitForSelector('#clock'); h = await get(p, 'sl.history'); eq(h.length, 1, 'duplicate after reload'); await p.close();
});
await test('two open tabs finishing the same session never double-count', async () => {
  const p1 = await fresh(ctx, { 'sl.timer': T({ running: true, endAt: now() - 40000, sid: 'dup-1' }) });
  const p2 = await ctx.newPage();
  await Promise.all([p1.reload(), p2.goto(URL_)]); await p1.waitForTimeout(1800);
  const h = await get(p1, 'sl.history'); eq(h.length, 1); eq(h.reduce((a, x) => a + x.x, 0), 35); await p1.close(); await p2.close();
});
await test('XP cannot be farmed: a 1-minute session earns 0 XP, a 10-minute earns 10, level-up fires at 100', async () => {
  let p = await fresh(ctx, { 'sl.timer': T({ running: true, endAt: now() - 6000, total: 60000, sid: 'short-1' }) });
  await p.waitForTimeout(400); let h = await get(p, 'sl.history'); eq(h[0].x, 0); eq(await p.textContent('#xpNum'), '0 / 100 XP');
  await set(p, 'sl.history', []); await set(p, 'sl.timer', T({ running: true, endAt: now() - 6000, total: 600000, sid: 'ten' })); await p.reload(); await p.waitForTimeout(500);
  h = await get(p, 'sl.history'); eq(h[0].x, 10);
  const big = Array.from({ length: 3 }, (_, i) => ({ id: 'b' + i, t: now() - 1e6 - i, m: 'focus', s: 1500, c: 1, x: 35 }));   // 105 XP -> level 2
  await set(p, 'sl.history', big); await set(p, 'sl.timer', T()); await p.reload(); await p.waitForSelector('#clock');
  eq(await p.textContent('#lvNum'), '2'); eq(await p.textContent('#xpNum'), '5 / 200 XP'); await p.close();
});
await test('level-up overlay appears when a session pushes you over a threshold', async () => {
  const p = await fresh(ctx, { 'sl.history': [{ id: 'x', t: now() - 1e6, m: 'focus', s: 1500, c: 1, x: 90 }], 'sl.timer': T({ running: true, endAt: now() + 1200, sid: 'lv' }) });
  await p.waitForSelector('#lvl.show', { timeout: 6000 }); eq(await p.textContent('#lvlN'), '2'); await p.close();
});
await test('reset/skip/mode-change are guarded; abandoning logs an interrupted session with 0 XP', async () => {
  const p = await fresh(ctx, { 'sl.timer': T({ running: true, endAt: now() + 1500000 - 120000, sid: 'ab-1' }) });   // 2 min in
  await p.click('#reset'); await p.waitForSelector('#dlg.open'); ok((await p.textContent('#dlgBox')).includes('Abandon this session?'), 'no dialog');
  await dbtn(p, 'Keep going'); eq((await get(p, 'sl.timer')).running, true); eq((await get(p, 'sl.history')).length, 0);
  await p.click('.tab[data-mode=long]'); await p.waitForSelector('#dlg.open'); await dbtn(p, 'Keep going'); eq((await get(p, 'sl.timer')).mode, 'focus');
  await p.click('#skip'); await p.waitForSelector('#dlg.open'); await dbtn(p, 'Keep going'); eq((await get(p, 'sl.timer')).mode, 'focus');
  await p.click('#reset'); await p.waitForSelector('#dlg.open'); await dbtn(p, 'Abandon');
  const h = await get(p, 'sl.history'); eq(h.length, 1); eq(h[0].c, 0); eq(h[0].x, 0); ok(h[0].s >= 118 && h[0].s <= 125, 'logged seconds ' + h[0].s);
  eq((await get(p, 'sl.timer')).running, false); eq(await p.textContent('#clock'), '25:00'); await p.close();
});
await test('a session under 10 s can be reset without a prompt and is not recorded', async () => {
  const p = await fresh(ctx); await p.click('#toggle'); await p.click('#reset'); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => document.getElementById('dlg').classList.contains('open'))), 'dialog shown'); eq((await get(p, 'sl.history')).length, 0); await p.close();
});
await test('changing durations never disturbs a running session', async () => {
  const p = await fresh(ctx, { 'sl.timer': T({ running: true, endAt: now() + 900000, sid: 'cfg' }) });
  await goto(p, 'settingsView'); await p.fill('#s-focus', '50'); await p.dispatchEvent('#s-focus', 'change'); await p.waitForTimeout(200);
  const t = await get(p, 'sl.timer'); eq(t.running, true); eq(t.total, 1500000); eq((await get(p, 'sl.settings')).focus, 50); await p.close();
});

/* ---------- tasks ---------- */
await test('tasks: create, prioritise, edit, complete, assign to a session, delete', async () => {
  const p = await fresh(ctx); await goto(p, 'tasksView');
  await p.fill('#taskInput', 'Write report'); await p.selectOption('#taskPri', '1'); await p.press('#taskInput', 'Enter');
  await p.fill('#taskInput', '<b>Read</b> chapter'); await p.click('#taskForm .btn-sm');
  eq((await p.locator('.task .tt').allTextContents()).length, 2);
  ok((await p.textContent('#taskList')).includes('<b>Read</b> chapter'), 'title must be escaped, not rendered as HTML');
  await p.locator('.task .tt').first().click(); await p.fill('#edTitle', 'Write final report'); await dbtn(p, 'Save');
  ok((await p.textContent('#taskList')).includes('Write final report'), 'edit');
  await p.locator('.task .pick').first().click(); await goto(p, 'timerView'); eq(await p.textContent('#taskName'), 'Write final report');
  const tid = (await get(p, 'sl.tasks')).find(t => t.title === 'Write final report').id;
  await set(p, 'sl.timer', T({ running: true, endAt: now() - 3000, sid: 'task-s', task: tid })); await p.reload(); await p.waitForTimeout(500);
  const t = (await get(p, 'sl.tasks')).find(x => x.id === tid); eq(t.n, 1); eq((await get(p, 'sl.history'))[0].k, tid);
  await goto(p, 'tasksView'); await p.locator('.task .ck').first().click();
  eq((await get(p, 'sl.tasks')).find(x => x.id === tid).done, true);
  await p.click('#taskFilter [data-f=done]'); eq(await p.locator('.task').count(), 1);
  await p.locator('.task .tt').first().click(); await dbtn(p, 'Delete'); await p.waitForSelector('#dlg.open'); await dbtn(p, 'Delete');
  eq((await get(p, 'sl.tasks')).length, 1); eq((await get(p, 'sl.history')).length, 1, 'history must survive task deletion');
  eq(p.errs, []); await p.close();
});

/* ---------- stats ---------- */
await test('statistics are computed from recorded sessions', async () => {
  const D = 864e5, n = now(), h = [];
  for (let i = 0; i < 3; i++) h.push({ id: 'd' + i, t: n - i * D - 1000, m: 'focus', s: 1500, c: 1, x: 35 });
  h.push({ id: 'cut', t: n - 5000, m: 'focus', s: 600, c: 0, x: 0 });
  const p = await fresh(ctx, { 'sl.history': h }); await goto(p, 'statsView'); await p.waitForTimeout(300);
  const txt = (await p.textContent('#statsView')).replace(/\s+/g, ' ');
  ok(txt.includes('Today35m'), 'today 35m: ' + txt.slice(0, 120));
  ok(txt.includes('This week1h 25m') || txt.includes('This week1h 35m') || /This week\d+h/.test(txt), 'week');
  ok(txt.includes('Sessions done3'), 'sessions'); ok(txt.includes('Completion75%'), 'completion'); ok(txt.includes('Day streak3days'), 'streak'); ok(txt.includes('Total XP105'), 'xp');
  eq(await p.locator('.hrow').count(), 4); eq(await p.locator('.heat i').count(), 28); eq(await p.locator('.col').count(), 7); await p.close();
});
await test('empty state shows zeros, no NaN/undefined', async () => {
  const p = await fresh(ctx); await goto(p, 'statsView'); const t = await p.textContent('#statsView'); ok(!/NaN|undefined|Infinity/.test(t), t.slice(0, 200)); await p.close();
});

/* ---------- settings, theme, sound ---------- */
await test('settings persist; theme + sound toggles apply', async () => {
  let p = await fresh(ctx); await goto(p, 'settingsView');
  await p.fill('#s-focus', '30'); await p.dispatchEvent('#s-focus', 'change'); await p.fill('#s-rounds', '3'); await p.dispatchEvent('#s-rounds', 'change');
  await p.click('.sw[data-a=violet]'); await p.check('#s-black'); await p.uncheck('#s-sound');
  await p.fill('#s-focus', '9999'); await p.dispatchEvent('#s-focus', 'change'); eq(await p.inputValue('#s-focus'), '180', 'clamped');
  await p.fill('#s-focus', '30'); await p.dispatchEvent('#s-focus', 'change');
  await p.reload(); await p.waitForSelector('#clock');
  eq(await p.textContent('#clock'), '30:00'); eq(await p.evaluate(() => document.body.dataset.accent), 'violet'); eq(await p.evaluate(() => document.body.dataset.black), '1');
  const s = await get(p, 'sl.settings'); eq(s.sound, false); eq(s.rounds, 3); eq(await p.locator('.dot').count(), 3); await p.close();
});

/* ---------- backup / restore / reset ---------- */
await test('backup export -> reset -> import restores everything; merge is idempotent', async () => {
  const h = [{ id: 'k1', t: now() - 5e4, m: 'focus', s: 1500, c: 1, x: 35 }, { id: 'k2', t: now() - 9e4, m: 'focus', s: 1500, c: 1, x: 35 }];
  const p = await fresh(ctx, { 'sl.history': h, 'sl.tasks': [{ id: 't1', title: 'Keep me', pri: 1, done: false, doneAt: null, created: now(), day: '2026-10-31', n: 0 }] });
  await goto(p, 'settingsView');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]);
  const file = path.join(os.tmpdir(), 'sl-backup-test.json'); await dl.saveAs(file);
  const j = JSON.parse(fs.readFileSync(file, 'utf8')); eq(j.app, 'solo-leveling'); eq(j.history.length, 2); eq(j.tasks.length, 1); eq(j.summary.totalXp, 70);
  await p.click('#wipeBtn'); await dbtn(p, 'Cancel'); eq((await get(p, 'sl.history')).length, 2, 'cancel must not erase');
  await p.click('#wipeBtn'); await dbtn(p, 'Erase everything'); await p.waitForTimeout(300);
  eq((await get(p, 'sl.history')).length, 0); await p.reload(); await p.waitForSelector('#clock'); eq((await get(p, 'sl.history')).length, 0, 'reset must stick');
  await goto(p, 'settingsView'); await p.setInputFiles('#importFile', file); await p.waitForSelector('#dlg.open'); await dbtn(p, 'Merge');
  eq((await get(p, 'sl.history')).length, 2); eq((await get(p, 'sl.tasks')).length, 1);
  await p.setInputFiles('#importFile', file); await p.waitForSelector('#dlg.open'); await dbtn(p, 'Merge'); eq((await get(p, 'sl.history')).length, 2, 'merge duplicated');
  fs.writeFileSync(file, '{"nope":1}'); await p.setInputFiles('#importFile', file); await p.waitForSelector('#dlg.open');
  ok((await p.textContent('#dlgBox')).includes('Cannot import'), 'bad file must be rejected'); await dbtn(p, 'OK');
  eq((await get(p, 'sl.history')).length, 2); eq(p.errs, []); await p.close();
});
await test('corrupted storage does not crash the app and a copy is kept', async () => {
  const p = await ctx.newPage(); await p.goto(URL_); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('sl.history', '{broken'); localStorage.setItem('sl.timer', 'null'); localStorage.setItem('sl.settings', '[1,2]'); });
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); await p.reload(); await p.waitForSelector('#clock');
  eq(await p.textContent('#clock'), '25:00'); eq(await p.evaluate(() => localStorage.getItem('sl.history.corrupt')), '{broken'); eq(p.errs, []); await p.close();
});
await test('v1 data from the previous version is migrated, not lost', async () => {
  const p = await ctx.newPage(); await p.goto(URL_);
  await p.evaluate(n => { localStorage.clear(); localStorage.setItem('sololeveling.history.v1', JSON.stringify([{ t: n - 1e6, m: 'focus', s: 1500, c: 1 }])); localStorage.setItem('sololeveling.state.v1', JSON.stringify({ settings: { focus: 40 }, mode: 'focus', running: false, remaining: 2400000, completed: 1 })); }, now());
  await p.reload(); await p.waitForSelector('#clock'); eq(await p.textContent('#clock'), '40:00'); eq((await get(p, 'sl.history')).length, 1);
  await p.reload(); eq((await get(p, 'sl.history')).length, 1); ok(await p.evaluate(() => !!localStorage.getItem('sololeveling.history.v1')), 'old key must remain'); await p.close();
});

/* ---------- layout ---------- */
const VPS = [[360, 640], [390, 844], [768, 1024], [1280, 800]];
for (const [w, h] of VPS) {
  await test(`layout ${w}x${h}: no horizontal scroll, no overlapping controls, nav reachable (all 4 views)`, async () => {
    const c = await newCtx({ width: w, height: h }); const hist = Array.from({ length: 30 }, (_, i) => ({ id: 'h' + i, t: now() - i * 3e6, m: 'focus', s: 1500, c: i % 5 ? 1 : 0, x: i % 5 ? 35 : 0 }));
    const p = await fresh(c, { 'sl.history': hist, 'sl.tasks': Array.from({ length: 8 }, (_, i) => ({ id: 't' + i, title: 'A fairly long task title number ' + i + ' to test wrapping behaviour', pri: 1 + i % 3, done: false, doneAt: null, created: now() - i, day: new Date().toISOString().slice(0, 10), n: i })) });
    for (const v of ['timerView', 'tasksView', 'statsView', 'settingsView']) {
      await goto(p, v); await p.waitForTimeout(250);
      const r = await p.evaluate(() => {
        const W = innerWidth, bad = [];
        document.querySelectorAll('header *, .view.active *, nav *').forEach(el => { const b = el.getBoundingClientRect(); if (b.width && b.height && (b.right > W + 1 || b.left < -1) && !el.closest('svg')) bad.push(el.tagName + '.' + el.className + ' ' + Math.round(b.left) + '..' + Math.round(b.right)); });
        const rc = id => document.getElementById(id).getBoundingClientRect(), nav = rc('nav');
        const ids = ['reset', 'toggle', 'skip'], r = ids.map(rc);
        const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 4), navOk: nav.bottom <= innerHeight + 1 && nav.top >= 0, overlap: overlap(r[0], r[1]) || overlap(r[1], r[2]), fits: r[1].bottom <= nav.top + 1 };
      });
      ok(r.sw <= r.W, `${v}: scrollWidth ${r.sw} > ${r.W}`); eq(r.bad, [], v + ' overflow'); ok(r.navOk, v + ' nav offscreen');
      if (v === 'timerView') { ok(!r.overlap, 'controls overlap'); ok(r.fits, 'controls hidden behind nav'); }
      await p.screenshot({ path: path.join(SHOTS, `${w}x${h}-${v}.png`) });
    }
    eq(p.errs, []); await c.close();
  });
}

/* ---------- offline + updates ---------- */
await test('works offline after the first online load (service worker + cache), data intact', async () => {
  const c = await newCtx(); const p = await fresh(c, { 'sl.history': [{ id: 'o1', t: now() - 1e5, m: 'focus', s: 1500, c: 1, x: 35 }] });
  await p.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
  const cached = await p.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k[0]); return (await c.keys()).map(r => new URL(r.url).pathname); });
  for (const f of ['/index.html', '/style.css', '/js/app.js', '/js/rpg.js', '/js/store.js', '/js/timer.js', '/js/audio.js', '/manifest.webmanifest', '/icons/icon-192.png']) ok(cached.includes(f), 'not precached: ' + f);
  await c.setOffline(true); await p.reload(); await p.waitForSelector('#clock');
  eq(await p.textContent('#xpNum'), '35 / 100 XP'); ok((await p.textContent('#chip')).includes('Offline'), 'offline chip');
  await p.click('#toggle'); eq((await get(p, 'sl.timer')).running, true);          // fully usable offline
  await goto(p, 'tasksView'); await p.fill('#taskInput', 'Offline task'); await p.press('#taskInput', 'Enter'); eq((await get(p, 'sl.tasks')).length, 1);
  await c.setOffline(false); await c.close();
});
await test('manifest + icons are valid for installation', async () => {
  const p = await ctx.newPage(); const m = await (await p.goto('http://127.0.0.1:8123/manifest.webmanifest')).json();
  eq(m.display, 'standalone'); ok(m.name === 'Solo Leveling' && m.start_url && m.icons.some(i => i.sizes === '512x512') && m.icons.some(i => i.sizes === '192x192'), 'manifest fields');
  for (const i of m.icons) { const r = await p.request.get('http://127.0.0.1:8123/' + i.src); ok(r.ok(), i.src); }
  await p.close();
});
await test('service-worker update: new version is picked up automatically, user data untouched', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-upd-')); fs.cpSync(ROOT, tmp, { recursive: true, filter: s => !/node_modules|\.git|tests/.test(s) });
  const s2 = await serve(tmp, 8124); const c = await newCtx(); const p = await c.newPage();
  await p.goto('http://127.0.0.1:8124/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
  await p.evaluate(() => { localStorage.setItem('sl.history', JSON.stringify([{ id: 'u1', t: Date.now() - 1e5, m: 'focus', s: 1500, c: 1, x: 35 }])); window.__marker = 1; });
  fs.writeFileSync(path.join(tmp, 'sw.js'), fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8').replace("VERSION = '3.0.0'", "VERSION = '3.0.1-test'"));
  await p.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await p.waitForFunction(() => !window.__marker, null, { timeout: 15000 });             // page reloaded itself
  await p.waitForSelector('#clock');
  const keys = await p.evaluate(() => caches.keys()); eq(keys.sort(), ['solo-leveling-3.0.1-test']); // old cache removed
  eq((await get(p, 'sl.history')).length, 1, 'data must survive an update'); eq(await p.textContent('#xpNum'), '35 / 100 XP');
  await c.close(); s2.kill();
});

await browser.close(); srv.kill();
for (const [s, n] of results) console.log(s, '-', n);
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
