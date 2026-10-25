// Headless verification of the sim (dist/sim.html).
//   node scripts/test/sim-test.mjs
// Bots drive through __simInput/__simStep with rendering paused; screenshots are
// taken with __simFrame so every camera and phone layout gets looked at.
import { launch, openSim, DESKTOP, PHONE, PHONE_LANDSCAPE, SHOTS } from './lib.mjs';
import path from 'node:path';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

/** Drive a bot until the rig is past the overpass or something ends the run. */
async function drive(page, { lane, lowerWithin = 0, speedKmh = 60, untilZ = -60, maxSecs = 90 }) {
  return page.evaluate(async ({ lane, lowerWithin, speedKmh, untilZ, maxSecs }) => {
    const d = window.__simDebug;
    const laneX = d.overpass.spans.find((s) => s.lane === lane);
    const target = (laneX.min + laneX.max) / 2;
    let s = window.__sim();
    let t = 0;
    while (t < maxSecs) {
      const steer = Math.max(-1, Math.min(1, 0.22 * (target - s.tractor.x) - 2.2 * s.heading));
      const throttle = s.speedKmh < speedKmh ? 1 : 0;
      const dist = s.tractor.z - 4.4 - (d.overpass.def.z + 6);
      window.__simInput({ throttle, brake: 0, steer, lower: lowerWithin > 0 && dist < lowerWithin, jake: false });
      s = window.__simStep(0.1);
      t += 0.1;
      if (s.phase !== 'drive' || s.trailer.z + 7.8 < untilZ) break;
    }
    window.__simInput(null);
    return { ...s, t };
  }, { lane, lowerWithin, speedKmh, untilZ, maxSecs });
}

/** Plate-reading bot: look at the posted clearances, pick a lane, lower only if it has to. */
async function plateBot(page) {
  const plan = await page.evaluate(() => {
    const d = window.__simDebug;
    const load = window.__sim().loadTarget;
    const lanes = d.overpass.spans.filter((s) => s.lane);
    const margin = 0.02;
    const fits = lanes.filter((l) => load + margin < l.clearance).sort((a, b) => b.clearance - a.clearance);
    if (fits.length) return { lane: fits[0].lane, lower: false };
    const low = lanes.filter((l) => load - 0.3 + margin < l.clearance).sort((a, b) => b.clearance - a.clearance);
    return low.length ? { lane: low[0].lane, lower: true } : null;
  });
  return { plan, end: plan ? await drive(page, { lane: plan.lane, lowerWithin: plan.lower ? 150 : 0 }) : null };
}

async function shot(page, name, secs = 0.5) {
  await page.evaluate(() => document.querySelector('.bs-start')?.remove());
  await page.evaluate((s) => { for (let i = 0; i < 6; i++) window.__simFrame(s / 6); }, secs);
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, timeout: 120000 });
  return file;
}

const browser = await launch();
try {
  // --- physics scenarios (rendering paused)
  {
    const { page, ctx, errors } = await openSim(browser, DESKTOP);
    let s = await page.evaluate(() => window.__simStep(2));
    check('settles on all wheels', s.tractor.contacts === 6 && s.trailer.contacts === 6, `contacts ${s.tractor.contacts}/${s.trailer.contacts}`);
    check('load calibrated to posted height', s.calibrated && Math.abs(s.loadTop - s.loadTarget) < 0.01, `top ${s.loadTop.toFixed(3)} m vs ${s.loadTarget} (calibration moved it ${(s.calibrationError * 100).toFixed(1)} cm)`);
    const z0 = s.tractor.z;
    s = await page.evaluate(() => window.__simStep(5));
    check('parked rig holds still', Math.abs(s.tractor.z - z0) < 0.02, `drift ${(s.tractor.z - z0).toFixed(3)} m in 5 s`);

    const bot = await plateBot(page);
    check('plate bot: delivers through the overpass', bot.end && bot.end.cleared && !bot.end.struck, `plan ${JSON.stringify(bot.plan)}, phase ${bot.end?.phase}, cleared ${bot.end?.cleared}, ${bot.end?.t.toFixed(1)} s`);

    await page.evaluate(() => window.__simDebug.reset());
    await page.evaluate(() => window.__simStep(2));
    let end = await drive(page, { lane: 'LEFT', lowerWithin: 150 });
    check('low lane + hold-to-lower clears 4.70 m', end.cleared && !end.struck, `phase ${end.phase}, lower ${end.lower.toFixed(2)}, cleared ${end.cleared}`);

    await page.evaluate(() => window.__simDebug.reset());
    await page.evaluate(() => window.__simStep(2));
    end = await drive(page, { lane: 'LEFT' });
    check('negative bot: low lane without lowering strikes', end.phase === 'strike' && end.struck?.by === 'load', `phase ${end.phase}, struck ${JSON.stringify(end.struck)}`);

    // rollover: hard in-lane swerves at speed
    await page.evaluate(() => window.__simDebug.reset({ z: 900 }));
    s = await page.evaluate(() => {
      window.__simStep(2);
      let st = window.__sim();
      window.__simInput({ throttle: 1, steer: 0 });
      while (st.speedKmh < 85) st = window.__simStep(0.5);
      let minUp = 1;
      for (const [steer, secs] of [[1, 1.0], [-1, 1.4], [1, 1.4], [-1, 1.0], [0, 3]]) {
        window.__simInput({ throttle: 1, steer });
        for (let k = 0; k < secs * 10; k++) { st = window.__simStep(0.1); minUp = Math.min(minUp, st.tractor.up, st.trailer.up); }
      }
      window.__simInput(null);
      return { ...st, minUp };
    });
    check('rollover: survives a hard swerve at 85 km/h', !s.rolled && s.minUp > 0.8, `min up ${s.minUp.toFixed(3)} (cos of max lean ${(Math.acos(Math.min(1, s.minUp)) * 57.3).toFixed(1)} deg), phase ${s.phase}`);
    check('no page errors (physics run)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // --- real keyboard: the start overlay has to be clicked before keys reach the game
  {
    const { page, ctx, errors } = await openSim(browser, DESKTOP);
    await page.evaluate(() => window.__simStep(1));
    const overlay = await page.isVisible('.bs-start');
    await page.mouse.click(640, 400);
    const gone = !(await page.isVisible('.bs-start'));
    await page.keyboard.down('KeyW');
    let s = await page.evaluate(() => window.__simStep(3));
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyD');
    const x0 = s.tractor.x;
    s = await page.evaluate(() => window.__simStep(1.5));
    await page.keyboard.up('KeyD');
    check('keyboard: click to drive, then W and D drive the rig', overlay && gone && s.speedKmh > 5 && s.tractor.x > x0, `overlay ${overlay}->${!gone}, speed ${s.speedKmh.toFixed(1)} km/h, D moved x +${(s.tractor.x - x0).toFixed(2)}`);
    check('no page errors (keyboard)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // --- screenshots: desktop chase + drone, approach, strike card
  {
    const { page, ctx, errors } = await openSim(browser, DESKTOP);
    await page.evaluate(() => window.__simStep(2));
    console.log('shot', await shot(page, 'desktop-chase-start'));
    await page.evaluate(() => window.__simDebug.reset({ z: 200, x: 9.85 }));
    await page.evaluate(() => window.__simStep(2));
    console.log('shot', await shot(page, 'desktop-chase-approach'));
    await page.evaluate(() => window.__simDebug.setCam('drone'));
    console.log('shot', await shot(page, 'desktop-drone-approach', 1));
    await page.evaluate(() => window.__simDebug.setCam('chase'));
    await page.evaluate(() => window.__simDebug.reset({ z: 40, x: 9.85 }));
    await page.evaluate(() => window.__simStep(2));
    console.log('shot', await shot(page, 'desktop-chase-bridge-close'));
    await page.evaluate(() => window.__simDebug.reset({ z: 200, x: 9.85 }));
    await page.evaluate(() => window.__simStep(2));
    await drive(page, { lane: 'LEFT', untilZ: -60, maxSecs: 60 });
    console.log('shot', await shot(page, 'desktop-strike-moment', 0.3));
    await page.evaluate(() => window.__simStep(2.5));
    console.log('shot', await shot(page, 'desktop-strike-card'));
    check('no page errors (desktop render)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // --- phone metrics: 390 CSS px at 2.77 DPR, portrait and landscape
  for (const [name, opts] of [['phone-portrait', PHONE], ['phone-landscape', PHONE_LANDSCAPE]]) {
    const { page, ctx, errors } = await openSim(browser, opts, '?touch');
    await page.evaluate(() => window.__simDebug.reset({ z: 160 }));
    await page.evaluate(() => window.__simStep(2));
    console.log('shot', await shot(page, `${name}-chase`));
    if (name === 'phone-portrait') {
      // Drive with real multi-touch (CDP touch events): hold GAS, drag the wheel right
      // with a second finger, then hold LOWER LOAD.
      const cdp = await ctx.newCDPSession(page);
      const centre = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }, sel);
      const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      await page.evaluate(() => window.__simDebug.reset({ z: 600 }));
      await page.evaluate(() => window.__simStep(1));
      const gas = await centre('.bs-gas'), wh = await centre('.bs-wheel'), low = await centre('.bs-lowerbtn');
      await touch('touchStart', [{ x: gas.x, y: gas.y, id: 1 }]);
      let s = await page.evaluate(() => window.__simStep(4));
      const sp = s.speedKmh;
      const g = { x: gas.x, y: gas.y, id: 1 };
      await touch('touchStart', [g, { x: wh.x, y: wh.y - wh.w * 0.4, id: 2 }]);
      for (let k = 1; k <= 6; k++) {
        const a = -Math.PI / 2 + (k / 6) * (Math.PI / 2);
        await touch('touchMove', [g, { x: wh.x + Math.cos(a) * wh.w * 0.4, y: wh.y + Math.sin(a) * wh.w * 0.4, id: 2 }]);
      }
      const x0 = s.tractor.x;
      s = await page.evaluate(() => window.__simStep(1.5));
      await touch('touchEnd', []);
      await touch('touchStart', [{ x: low.x, y: low.y, id: 3 }]);
      s = await page.evaluate(() => window.__simStep(1.5));
      await touch('touchEnd', []);
      check('touch: gas, wheel and LOWER LOAD drive the rig', sp > 5 && s.tractor.x - x0 > 0.3 && s.lower > 0.99, `speed ${sp.toFixed(1)} km/h after 4 s, wheel right moved x +${(s.tractor.x - x0).toFixed(2)} m, lower ${s.lower.toFixed(2)}`);
    }
    check(`no page errors (${name})`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
