// Renders the gameplay trailer (media/trailer.mp4) and the link preview image
// (public/og.jpg) from the single-file build, frame by frame through the test
// hooks, then encodes with ffmpeg. Slow under swiftshader (about a second a
// frame) but deterministic.
//   node scripts/media/trailer.mjs [--og-only]
import { launch, openSim, DESKTOP } from '../test/lib.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const FPS = 30;
const frames = path.join(root, 'test-results/trailer-frames');
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });
fs.mkdirSync(path.join(root, 'media'), { recursive: true });

const browser = await launch();
const { page, errors } = await openSim(browser, DESKTOP, '', { keepDispatch: true, keepTitle: true });
await page.addStyleTag({ content: '.bs-keys{display:none!important}' });
let n = 0;
const frame = async (dt = 1 / FPS) => {
  await page.evaluate((dt) => window.__simFrame(dt), dt);
  await page.screenshot({ path: path.join(frames, `f${String(n++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 88, timeout: 120000 });
};
const hold = async (secs) => { for (let i = 0; i < secs * FPS; i++) await frame(); };
// One frame of the plate-reading bot: pick the lane that fits (lowering if needed).
const drive = (opts = {}) => page.evaluate((o) => {
  const s = window.__sim();
  const op = s.next;
  const lanes = op ? [...op.lanes].sort((a, b) => b.clearance - a.clearance) : [];
  const fit = lanes.find((l) => s.loadTarget + 0.02 < l.clearance);
  const low = lanes.find((l) => s.loadTarget - 0.28 < l.clearance);
  const plan = o.force ?? (fit ? { lane: fit.lane, lower: false } : low ? { lane: low.lane, lower: true } : null);
  const lane = plan && op?.lanes.find((l) => l.lane === plan.lane);
  const target = lane ? (lane.min + lane.max) / 2 : 13.55;
  const dist = op ? s.tractor.z - 4.4 - (op.z + op.halfZ) : 1e9;
  window.__simInput({ throttle: s.speedKmh < (o.speed ?? 68) ? 1 : 0, steer: Math.max(-1, Math.min(1, 0.22 * (target - s.tractor.x) - 2.2 * s.heading)), lower: !!(plan?.lower && dist < 120), jake: false });
}, opts);

if (!process.argv.includes('--og-only')) {
  // 1. title over the attract orbit
  await hold(2.5);
  // 2. the twin hopper bins: lower and switch lanes at the first overpass
  await page.evaluate(() => { window.__simDebug.reset({ load: 4, rolling: true }); window.__simDebug.setTime('golden'); window.__simDebug.setCam('chase'); });
  for (let i = 0; i < 7 * FPS; i++) { await drive(); await frame(); }
  // 3. cockpit through the next one
  await page.evaluate(() => window.__simDebug.setCam('cockpit'));
  for (let i = 0; i < 3 * FPS; i++) { await drive(); await frame(); }
  // 4. dusk, and the track hoe takes the wrong lane: strike, replays, chyron, bill
  await page.evaluate(() => { window.__simDebug.setTime('dusk'); window.__simDebug.reset({ load: 0, z: 790, rolling: true }); window.__simDebug.setCam('chase'); });
  let phase = 'drive';
  for (let i = 0; i < 12 * FPS && phase === 'drive'; i++) {
    await drive({ force: { lane: 'RIGHT', lower: false }, speed: 75 });
    await frame();
    phase = await page.evaluate(() => window.__sim().phase);
  }
  await page.evaluate(() => window.__simInput(null));
  for (let i = 0; i < 9.5 * FPS; i++) await frame(); // live hit, side replay, chopper, card
  await hold(1.5);
  // 5. back to the title
  await page.evaluate(() => { window.__simDebug.setTime('golden'); window.__simDebug.reset({ load: 0 }); window.__simDebug.showTitle(); });
  await hold(2.5);

  const out = path.join(root, 'media/trailer.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frames, 'f%05d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', out]);
  console.log(`${out}: ${n} frames, ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
}

// Link preview: a golden-hour drone frame at the first overpass with the logo.
await page.evaluate(() => { window.__simDebug.hideTitle?.(); window.__simDebug.setTime('golden'); window.__simDebug.reset({ load: 2, z: 740, x: 9.85 }); window.__simDebug.setCam('drone'); });
await page.evaluate(() => window.__simStep(1.5));
await page.evaluate(() => { for (let i = 0; i < 8; i++) window.__simFrame(0.1); });
const og = await page.evaluate(() => window.__simDebug.ogImage());
fs.writeFileSync(path.join(root, 'public/og.jpg'), Buffer.from(og.split(',')[1], 'base64'));
console.log('public/og.jpg', (fs.statSync(path.join(root, 'public/og.jpg')).size / 1024).toFixed(0), 'KB');
console.log('errors', errors);
await browser.close();
