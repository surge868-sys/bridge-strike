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

/**
 * Plate-reading bot. For each overpass ahead it reads the posted plates, picks the
 * lane with the most headroom that the load fits (lowered only if it must), changes
 * lanes in the gap between bridges, and holds LOWER from 120 m out until it is past.
 * `force` overrides the plan (negative tests): { lane, lower }.
 */
async function routeBot(page, { speedKmh = 65, maxSecs = 200, force = null } = {}) {
  return page.evaluate(async ({ speedKmh, maxSecs, force }) => {
    const margin = 0.02;
    let s = window.__sim();
    const plans = [];
    let t = 0;
    while (t < maxSecs) {
      const op = s.next;
      let plan = null;
      if (op) {
        if (force) plan = force;
        else {
          const lanes = [...op.lanes].sort((a, b) => b.clearance - a.clearance);
          const fit = lanes.find((l) => s.loadTarget + margin < l.clearance);
          const low = lanes.find((l) => s.loadTarget - 0.3 + margin < l.clearance);
          plan = fit ? { lane: fit.lane, lower: false } : low ? { lane: low.lane, lower: true } : { lane: 'RIGHT', lower: false, impossible: true };
        }
        if (!plans.length || plans[plans.length - 1].id !== op.id) plans.push({ id: op.id, ...plan });
      }
      const laneDef = op ? op.lanes.find((l) => l.lane === (plan?.lane ?? 'RIGHT')) : null;
      const target = laneDef ? (laneDef.min + laneDef.max) / 2 : 13.55;
      const dist = op ? s.tractor.z - 4.4 - (op.z + op.halfZ) : Infinity;
      const steer = Math.max(-1, Math.min(1, 0.22 * (target - s.tractor.x) - 2.2 * s.heading));
      window.__simInput({ throttle: s.speedKmh < speedKmh ? 1 : 0, brake: 0, steer, lower: !!(plan?.lower && dist < 120), jake: false });
      s = window.__simStep(0.1);
      t += 0.1;
      if (s.phase !== 'drive') break;
    }
    window.__simInput(null);
    return { ...s, t, plans };
  }, { speedKmh, maxSecs, force });
}

async function shot(page, name, secs = 0.5) {
  await page.evaluate((s) => { for (let i = 0; i < 6; i++) window.__simFrame(s / 6); }, secs);
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, timeout: 120000 });
  console.log('shot', file);
  return file;
}

const browser = await launch();
try {
  // --- physics scenarios (rendering paused)
  {
    const { page, ctx, errors } = await openSim(browser, DESKTOP);
    let s = await page.evaluate(() => window.__simStep(2));
    check('settles on all wheels', s.tractor.contacts === 6 && s.trailer.contacts === 6, `contacts ${s.tractor.contacts}/${s.trailer.contacts}`);
    const z0 = s.tractor.z;
    s = await page.evaluate(() => window.__simStep(3));
    check('parked rig holds still', Math.abs(s.tractor.z - z0) < 0.02, `drift ${(s.tractor.z - z0).toFixed(3)} m in 3 s`);

    for (let i = 0; i < 5; i++) {
      await page.evaluate((i) => window.__simDebug.reset({ load: i }), i);
      s = await page.evaluate(() => window.__simStep(2));
      const cal = s.calibrated && Math.abs(s.loadTop - s.loadTarget) < 0.01;
      const end = await routeBot(page);
      const lowered = end.plans.filter((p) => p.lower).map((p) => p.id);
      check(`plate bot delivers load ${i + 1} (${end.load}, ${end.loadTarget} m) through all six`,
        cal && end.delivered && end.cleared === 6 && !end.struck && !end.plans.some((p) => p.impossible),
        `calibrated top ${s.loadTop.toFixed(3)} m, phase ${end.phase}, cleared ${end.cleared}/6, ${end.t.toFixed(0)} s, lanes ${end.plans.map((p) => p.lane[0] + (p.lower ? 'v' : '')).join(' ')}, lowered at [${lowered.join(', ')}]`);
    }

    await page.evaluate(() => window.__simDebug.reset({ load: 0 }));
    await page.evaluate(() => window.__simStep(2));
    let end = await routeBot(page, { force: { lane: 'LEFT', lower: false } });
    check('negative bot: load 1 in the 4.70 m lane without lowering strikes Hwy 16', end.phase === 'strike' && end.struck?.at === 'hwy16-circle' && end.struck?.by === 'load', `phase ${end.phase}, struck ${JSON.stringify(end.struck)}`);

    await page.evaluate(() => window.__simDebug.reset({ load: 3, z: 400 }));
    await page.evaluate(() => window.__simStep(2));
    end = await routeBot(page, { force: { lane: 'RIGHT', lower: false } });
    check('negative bot: grain bin (5.20 m) in the 5.00 m lane strikes the CPKC rail bridge', end.phase === 'strike' && end.struck?.at === 'cpkc', `phase ${end.phase}, struck ${JSON.stringify(end.struck)}`);

    // rollover: hard in-lane swerves at speed
    // Load 1 in the right lane fits the first overpass, so nothing else ends the run.
    await page.evaluate(() => window.__simDebug.reset({ load: 0, z: 930 }));
    s = await page.evaluate(() => {
      window.__simStep(2);
      let st = window.__sim();
      window.__simInput({ throttle: 1, steer: 0 });
      for (let k = 0; k < 120 && st.speedKmh < 85 && st.phase === 'drive'; k++) st = window.__simStep(0.5);
      let minUp = 1;
      for (const [steer, secs] of [[1, 1.0], [-1, 1.4], [1, 1.4], [-1, 1.0], [0, 3]]) {
        window.__simInput({ throttle: 1, steer });
        for (let k = 0; k < secs * 10; k++) { st = window.__simStep(0.1); minUp = Math.min(minUp, st.tractor.up, st.trailer.up); }
      }
      window.__simInput(null);
      return { ...st, minUp };
    });
    check('rollover: survives a hard swerve at 85 km/h', !s.rolled && s.minUp > 0.8, `min up ${s.minUp.toFixed(3)} (max lean ${(Math.acos(Math.min(1, s.minUp)) * 57.3).toFixed(1)} deg), phase ${s.phase}`);
    check('no page errors (physics run)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // --- dispatch sheet + real keyboard: rolling out focuses the framed game
  {
    const { page, ctx, errors } = await openSim(browser, DESKTOP, '', { keepDispatch: true });
    await page.evaluate(() => window.__simStep(1));
    const visible = await page.isVisible('.bs-dispatch');
    await shot(page, 'desktop-dispatch');
    await page.click('.bs-dispatch .roll');
    let s = await page.evaluate(() => window.__sim());
    const rolled = s.phase === 'drive' && !(await page.isVisible('.bs-dispatch'));
    await page.keyboard.down('KeyW');
    s = await page.evaluate(() => window.__simStep(3));
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyD');
    const x0 = s.tractor.x;
    s = await page.evaluate(() => window.__simStep(1.5));
    await page.keyboard.up('KeyD');
    check('dispatch: ROLL OUT starts the run; W and D drive the rig', visible && rolled && s.speedKmh > 5 && s.tractor.x > x0, `dispatch shown ${visible}, rolled ${rolled}, speed ${s.speedKmh.toFixed(1)} km/h, D moved x +${(s.tractor.x - x0).toFixed(2)}`);
    check('no page errors (dispatch/keyboard)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // --- screenshots: approach, rail bridge, drone, strike and delivery cards
  {
    const { page, ctx, errors } = await openSim(browser, DESKTOP);
    await page.evaluate(() => window.__simStep(2));
    await shot(page, 'desktop-chase-start');
    await page.evaluate(() => window.__simDebug.reset({ z: 300, x: 13.55 }));
    await page.evaluate(() => window.__simStep(2));
    await shot(page, 'desktop-chase-rail-approach');
    await page.evaluate(() => window.__simDebug.reset({ z: 262, x: 9.85 }));
    await page.evaluate(() => window.__simStep(2));
    await shot(page, 'desktop-chase-rail-close');
    await page.evaluate(() => window.__simDebug.setCam('drone'));
    await shot(page, 'desktop-drone-rail', 1);
    await page.evaluate(() => window.__simDebug.setCam('chase'));
    await page.evaluate(() => window.__simDebug.reset({ load: 3, z: 400 }));
    await page.evaluate(() => window.__simStep(2));
    await routeBot(page, { force: { lane: 'RIGHT', lower: false } });
    await page.evaluate(() => window.__simStep(2.5));
    await shot(page, 'desktop-strike-rail-card');
    await page.evaluate(() => window.__simDebug.reset({ load: 1, z: -400 }));
    await page.evaluate(() => window.__simStep(2));
    await routeBot(page);
    await shot(page, 'desktop-delivered-card');
    check('no page errors (desktop render)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // --- phone metrics: 390 CSS px at 2.77 DPR, portrait and landscape
  for (const [name, opts] of [['phone-portrait', PHONE], ['phone-landscape', PHONE_LANDSCAPE]]) {
    const { page, ctx, errors } = await openSim(browser, opts, '?touch', { keepDispatch: true });
    await page.evaluate(() => window.__simStep(1));
    await shot(page, `${name}-dispatch`);
    await page.evaluate(() => window.__simDebug.reset({ z: 520 }));
    await page.evaluate(() => window.__simStep(2));
    await shot(page, `${name}-chase`);
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
