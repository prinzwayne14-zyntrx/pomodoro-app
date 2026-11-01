// Renders icons/icon.svg + icons/maskable.svg to every PNG the app and launchers need.
// Needs Playwright + Chromium.   Run: npm run icons
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const dir = path.resolve(__dirname, '..', 'icons');
const JOBS = [
  ['icon.svg', [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['icon-167.png', 167], ['icon-152.png', 152], ['favicon-32.png', 32]]],
  ['maskable.svg', [['maskable-512.png', 512], ['maskable-192.png', 192]]]
];
(async () => {
  const b = await chromium.launch();
  for (const [src, outs] of JOBS) {
    const svg = fs.readFileSync(path.join(dir, src), 'utf8');
    for (const [name, s] of outs) {
      const p = await b.newPage({ viewport: { width: s, height: s } });
      await p.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body>`);
      await p.screenshot({ path: path.join(dir, name) }); await p.close();
    }
  }
  await b.close(); console.log('icons written');
})();
