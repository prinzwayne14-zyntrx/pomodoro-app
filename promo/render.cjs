// Renders promo/index.html to an MP4 (1080x1920, 30 fps, with soundtrack).
// Needs Playwright + Chromium, python3 and ffmpeg.   Run:  node promo/render.cjs [out.mp4] [--frames 0,90,300]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2), fi = args.indexOf('--frames');
const only = fi >= 0 ? args[fi + 1].split(',').map(Number) : null;
const OUT = path.resolve(args.find((a, i) => !a.startsWith('--') && (fi < 0 || i !== fi + 1)) || path.join(ROOT, 'promo', 'zyntry-promo.mp4'));
const FPS = 30, DUR = 30, PORT = 8155;

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
    page.on('pageerror', e => console.error('page error:', e.message));
    await page.goto(`http://127.0.0.1:${PORT}/promo/index.html`);
    await page.waitForFunction(() => window.promoReady === true);
    const stage = page.locator('#stage');
    if (only) {                                   // quick look at single frames
      for (const f of only) { await page.evaluate(t => window.renderFrame(t), f / FPS); await stage.screenshot({ path: OUT.replace(/\.mp4$/, '') + `-f${f}.png` }); }
      return;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-')), wav = path.join(tmp, 'audio.wav');
    console.log('rendering soundtrack…');
    fs.writeFileSync(wav, Buffer.from(await page.evaluate(() => window.soundtrack()), 'base64'));
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', '-i', wav,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res, rej) => ff.on('close', c => c ? rej(new Error('ffmpeg exit ' + c)) : res()));
    for (let f = 0; f < FPS * DUR; f++) {
      await page.evaluate(t => window.renderFrame(t), f / FPS);
      const buf = await stage.screenshot({ type: 'png' });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (f % 90 === 0) console.log(`frame ${f}/${FPS * DUR}`);
    }
    ff.stdin.end(); await done;
    console.log('wrote', OUT);
  } finally { await browser.close(); srv.kill(); }
})();
