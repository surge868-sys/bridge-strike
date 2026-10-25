// Shared Playwright helpers for the sim tests.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const SIM = 'file://' + path.join(root, 'dist/sim.html');
export const SHOTS = path.join(root, 'test-results');
fs.mkdirSync(SHOTS, { recursive: true });

export async function launch() {
  return chromium.launch({
    executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  });
}

export const DESKTOP = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
// Phone metrics: 390 CSS px wide at 2.77 DPR (portrait), and the same phone held landscape.
export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.77, isMobile: true, hasTouch: true };
export const PHONE_LANDSCAPE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2.77, isMobile: true, hasTouch: true };

export async function openSim(browser, ctxOpts = DESKTOP, query = '', { keepDispatch = false } = {}) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(SIM + query);
  await page.waitForFunction(() => typeof window.__sim === 'function', null, { timeout: 120000 });
  await page.evaluate(() => window.__simPause(true));
  // Most tests skip the dispatch sheet and drive straight away.
  if (!keepDispatch) await page.evaluate(() => window.__simDebug.reset());
  return { ctx, page, errors };
}
