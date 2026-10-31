// Renders icons/icon.svg to the PNG app icons. Needs `playwright` + Chromium.  Run: node tools/icons.cjs
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
(async () => {
  const svg = fs.readFileSync(path.join(root, 'icons/icon.svg'), 'utf8');
  const b = await chromium.launch();
  for (const [name, s] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body>`);
    await p.screenshot({ path: path.join(root, 'icons', name) }); await p.close();
  }
  await b.close(); console.log('ok');
})();
