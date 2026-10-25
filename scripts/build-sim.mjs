// Builds dist/sim.html: one file with the bundled sim, Rapier wasm (already inlined
// by rapier3d-compat), fonts, models and textures embedded as base64. The page
// decodes bytes itself; fetch() of data: URLs is blocked in the artifact sandbox.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pub = path.join(root, 'public');
const ASSETS = [
  ...fs.readdirSync(path.join(pub, 'models')).filter((f) => f.endsWith('.glb')).map((f) => `models/${f}`),
  ...fs.readdirSync(path.join(pub, 'textures')).map((f) => `textures/${f}`),
  ...fs.readdirSync(path.join(pub, 'fonts')).map((f) => `fonts/${f}`),
];

const result = await build({
  entryPoints: [path.join(root, 'src/sim/standalone.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
});
const js = result.outputFiles[0].text;
const assets = Object.fromEntries(ASSETS.map((p) => [p, fs.readFileSync(path.join(pub, p)).toString('base64')]));

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#0b6b3a">
<title>BRIDGE STRIKE!</title>
<style>html,body{margin:0;height:100%;background:#1a1410;overflow:hidden;overscroll-behavior:none}#app{position:fixed;inset:0}</style>
</head><body><div id="app"></div>
<script>window.__BS_ASSETS=${JSON.stringify(assets)};</script>
<script>${js.replace(/<\/script/g, '<\\/script')}</script>
</body></html>`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/sim.html');
fs.writeFileSync(out, html);
// Artifact variant: the artifact host supplies the document skeleton, so this is
// page content only. Single dark look; HUD controls already add safe-area insets.
const fragment = `<title>BRIDGE STRIKE!</title>
<style>:root{color-scheme:dark;background:#1a1410}html,body{height:100%;background:#1a1410;overflow:hidden;overscroll-behavior:none}#app{position:fixed;inset:0}</style>
<div id="app"></div>
<script>window.__BS_ASSETS=${JSON.stringify(assets)};</script>
<script>${js.replace(/<\/script/g, '<\\/script')}</script>
`;
fs.writeFileSync(path.join(root, 'dist/artifact.html'), fragment);
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
console.log(`dist/sim.html ${mb(html.length)} (js ${mb(js.length)}, assets ${mb(JSON.stringify(assets).length)})`);
