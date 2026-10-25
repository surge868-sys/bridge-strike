// Renders a 4-view turntable sheet of a GLB with a 1 m ground grid.
// Usage: node scripts/assets/turntable.mjs <in.glb> <out.png> [label]
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Playwright is preinstalled globally (its Chromium lives at /opt/pw-browsers); resolve it via require.
const { chromium } = createRequire(import.meta.url)('playwright');
const [, , input, output, label = path.basename(input), orthoArg] = process.argv;
// optional 4th arg "z0,z1,y0,y1": orthographic side view of that window with a 0.5 m grid (camera on +x, +z to the left)
const ortho = orthoArg ? orthoArg.split(',').map(Number) : null;
if (!input || !output) {
  console.error('usage: turntable.mjs <in.glb> <out.png> [label]');
  process.exit(1);
}

const bundle = await build({
  entryPoints: [path.join(here, 'turntable-page.js')],
  bundle: true, write: false, format: 'iife', minify: true,
});
const js = bundle.outputFiles[0].text;
const html = `<!doctype html><html><body style="margin:0;background:#000;font:14px sans-serif">
<div id="label" style="position:fixed;left:12px;top:8px;color:#fff;text-shadow:0 1px 2px #000;z-index:2"></div>
<script>${js}</script></body></html>`;

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
await page.setContent(html);
const b64 = fs.readFileSync(input).toString('base64');
const info = await page.evaluate(async ([b, o]) => window.renderTurntable(b, o ? { ortho: o } : {}), [b64, ortho]);
if (ortho) {
  await page.evaluate((t) => { document.getElementById('label').textContent = t; }, `${label} | ortho z ${ortho[0]}..${ortho[1]} y ${ortho[2]}..${ortho[3]} | grid 0.5 m`);
  await page.setViewportSize({ width: info.width, height: info.height });
  await page.screenshot({ path: output }); await browser.close(); console.log(JSON.stringify(info)); process.exit(0);
}
const [sx, sy, sz] = info.size.map((v) => v.toFixed(2));
await page.evaluate((t) => { document.getElementById('label').textContent = t; },
  `${label}  |  W ${sx} m  H ${sy} m  L ${sz} m  |  ${Math.round(info.triangles).toLocaleString()} tris`);
fs.mkdirSync(path.dirname(output), { recursive: true });
await page.screenshot({ path: output });
await browser.close();
console.log(JSON.stringify({ input, output, ...info }));
