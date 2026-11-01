// Headless verification of the sim (dist/sim.html).
//   node scripts/test/sim-test.mjs
// Bots drive through __simInput/__simStep with rendering paused; screenshots are
// taken with __simFrame so every camera and phone layout gets looked at.
import { launch, openSim, DESKTOP, PHONE, PHONE_LANDSCAPE, SHOTS } from './lib.mjs';
import path from 'node:path';
import fs from 'node:fs';

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
    let lanes = await page.evaluate(() => window.__sim().next.lanes.map((l) => l.clearance.toFixed(2)).join(' / '));
    let end = await routeBot(page, { force: { lane: 'RIGHT', lower: false } });
    check(`negative bot: load 1 (4.75 m) unlowered in the right lane (plates ${lanes}) strikes Hwy 16`, end.phase === 'strike' && end.struck?.at === 'hwy16-circle' && end.struck?.by === 'load', `phase ${end.phase}, struck ${JSON.stringify(end.struck)}`);

    await page.evaluate(() => window.__simDebug.reset({ load: 3, z: 400 }));
    await page.evaluate(() => window.__simStep(2));
    lanes = await page.evaluate(() => window.__sim().next.lanes.map((l) => l.clearance.toFixed(2)).join(' / '));
    end = await routeBot(page, { force: { lane: 'RIGHT', lower: true } });
    check(`negative bot: grain bin (5.20 m) fully lowered in the no-go lane (plates ${lanes}) still strikes CPKC`, end.phase === 'strike' && end.struck?.at === 'cpkc', `phase ${end.phase}, struck ${JSON.stringify(end.struck)}`);
    // strike sequence: live impact, slow-motion replay, then the bill
    const stages = [], labels = [];
    const tab0 = await page.evaluate(() => window.__simDebug.ledger());
    for (const secs of [0.3, 1.0, 4.0, 3.0]) {
      stages.push((await page.evaluate((x) => window.__simStep(x), secs)).strikeStage);
      labels.push((await page.isVisible('.bs-news')) ? await page.textContent('.bs-replay .tag') : '-');
    }
    const card = await page.isVisible('.bs-card');
    const tab1 = await page.evaluate(() => window.__simDebug.ledger());
    const tabRow = card ? await page.textContent('.bs-card tr.tab') : '';
    check('strike plays live, side replay, chopper replay with the news chyron, then the bill', stages.join() === 'live,replay,replay,done' && labels[1] === 'REPLAY' && labels[2] === 'CHOPPER CAM' && card, `stages ${stages.join(' > ')}, news/labels ${labels.join(' > ')}, card ${card}`);
    await page.evaluate(() => window.__simFrame(0.05));
    await page.click('.bs-card .go:has-text("SHARE")');
    const shareImg = await page.evaluate(() => { const i = document.querySelector('.bs-share img'); return i ? { w: i.naturalWidth, h: i.naturalHeight, src: i.src.length } : null; });
    const cardJpg = await page.evaluate(() => window.__simDebug.shareCard());
    if (cardJpg) fs.writeFileSync(path.join(SHOTS, 'share-card-strike.jpg'), Buffer.from(cardJpg.split(',')[1], 'base64'));
    await page.click('.bs-share .cl');
    check('SHARE builds a 1080x1350 card with the impact frame', shareImg?.w === 1080 && shareImg?.h === 1350 && shareImg.src > 200000, `share image ${JSON.stringify(shareImg)}`);
    check('damage ledger adds the bill to the running city tab', tab1.strikes === tab0.strikes + 1 && tab1.total > tab0.total && /Running city tab/.test(tabRow), `strikes ${tab0.strikes} -> ${tab1.strikes}, tab $${Math.round(tab0.total)} -> $${Math.round(tab1.total)}, row "${tabRow}"`);

    // rollover: hard in-lane swerves at speed
    // Load 1 held lowered clears the first two overpasses in either lane, so nothing else ends the run.
    await page.evaluate(() => window.__simDebug.reset({ load: 0, z: 1250 }));
    s = await page.evaluate(() => {
      window.__simStep(2);
      let st = window.__sim();
      window.__simInput({ throttle: 1, steer: 0, lower: true });
      for (let k = 0; k < 120 && st.speedKmh < 85 && st.phase === 'drive'; k++) st = window.__simStep(0.5);
      let minUp = 1;
      for (const [steer, secs] of [[1, 1.0], [-1, 1.4], [1, 1.4], [-1, 1.0], [0, 3]]) {
        window.__simInput({ throttle: 1, steer, lower: true });
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
    const { page, ctx, errors } = await openSim(browser, DESKTOP, '', { keepDispatch: true, keepTitle: true });
    await page.evaluate(() => window.__simStep(1));
    const titled = await page.isVisible('.bs-title');
    await shot(page, 'desktop-title');
    await page.keyboard.press('Enter');
    const pastTitle = !(await page.isVisible('.bs-title'));
    check('title screen shows first; any key opens dispatch', titled && pastTitle && (await page.isVisible('.bs-dispatch')), `title ${titled}, gone after key ${pastTitle}`);
    const visible = await page.isVisible('.bs-dispatch');
    await shot(page, 'desktop-dispatch');
    await page.click('.bs-dispatch .roll');
    let s = await page.evaluate(() => window.__simStep(0.5));
    const rolled = s.phase === 'drive' && !(await page.isVisible('.bs-dispatch'));
    const rollKmh = s.speedKmh, rollStable = s.tractor.contacts === 6 && s.trailer.contacts === 6 && Math.abs(s.heading) < 0.01;
    check('rolling start: ROLL OUT launches the rig at about 60 km/h, settled and calibrated', rollKmh > 55 && rollKmh < 63 && rollStable && s.calibrated && Math.abs(s.calibrationError) < 0.3, `speed ${rollKmh.toFixed(1)} km/h, contacts ${s.tractor.contacts}/${s.trailer.contacts}, heading ${s.heading.toFixed(4)}, calibrated ${s.calibrated} (err ${s.calibrationError.toFixed(3)})`);
    await page.keyboard.down('KeyW');
    s = await page.evaluate(() => window.__simStep(3));
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyD');
    const x0 = s.tractor.x;
    s = await page.evaluate(() => window.__simStep(1.5));
    await page.keyboard.up('KeyD');
    check('dispatch: ROLL OUT starts the run; W and D drive the rig', visible && rolled && s.speedKmh > 5 && s.tractor.x > x0, `dispatch shown ${visible}, rolled ${rolled}, speed ${s.speedKmh.toFixed(1)} km/h, D moved x +${(s.tractor.x - x0).toFixed(2)}`);
    await page.keyboard.down('KeyW');
    await page.evaluate(() => window.__simStep(3));
    await page.evaluate(() => window.__simFrame(0.1));
    const au = await page.evaluate(() => window.__simDebug.audio());
    await page.keyboard.up('KeyW');
    await page.keyboard.press('KeyM');
    const au2 = await page.evaluate(() => window.__simDebug.audio());
    await page.keyboard.press('KeyM');
    check('engine audio runs and follows the rig; M mutes', au.state === 'running' && au.rpm > 900 && au.gear >= 5 && au2.muted && !au.muted, `audio ${au.state}, ${Math.round(au.rpm)} rpm in gear ${au.gear}, M -> muted ${au2.muted}`);
    const cams = [];
    for (let k = 0; k < 3; k++) { await page.keyboard.press('KeyC'); cams.push((await page.evaluate(() => window.__sim())).camMode); }
    await page.keyboard.press('KeyT');
    const tod = (await page.evaluate(() => window.__sim())).timeOfDay;
    await page.evaluate(() => window.__simDebug.setTime('golden'));
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(50);
    s = await page.evaluate(() => window.__simStep(0.5));
    check('R restarts rolling from the start line', s.phase === 'drive' && s.speedKmh > 55 && s.tractor.z > 860, `phase ${s.phase}, speed ${s.speedKmh.toFixed(1)} km/h, z ${s.tractor.z.toFixed(0)}`);
    check('C cycles chase > cockpit > drone; T changes time of day', cams.join() === 'cockpit,drone,chase' && tod === 'midday', `cams ${cams.join(',')}, T -> ${tod}`);
    check('no page errors (dispatch/keyboard)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // --- screenshots: approach, rail bridge, drone, strike and delivery cards
  {
    const { page, ctx, errors } = await openSim(browser, DESKTOP);
    // Frames keep rendering while a new load's model loads; they must never touch the old rig.
    const swap = await page.evaluate(async () => {
      try {
        const p = window.__simDebug.reset({ load: 2 });
        for (let i = 0; i < 4; i++) window.__simFrame(0.016);
        await p;
        window.__simFrame(0.016);
        return window.__sim().load;
      } catch (e) { return 'threw: ' + e; }
    });
    check('switching loads while frames render never touches the removed rig', swap === 'Heavy equipment', `result ${swap}`);
    await page.evaluate(() => window.__simDebug.reset({ load: 0 }));
    await page.evaluate(() => window.__simStep(2));
    await shot(page, 'desktop-chase-start');
    await page.evaluate(() => window.__simDebug.setCam('cockpit'));
    await shot(page, 'desktop-cockpit-start');
    // time of day: each preset applies, rebuilds the environment and renders
    const times = [];
    for (const t of ['midday', 'dusk', 'golden']) {
      await page.evaluate((t) => window.__simDebug.setTime(t), t);
      if (t !== 'golden') await shot(page, `desktop-cockpit-${t}`, 0.1);
      times.push((await page.evaluate(() => window.__sim())).timeOfDay);
    }
    const st = await page.evaluate(() => window.__sim());
    check('post stack on; time of day presets switch', st.post && times.join() === 'midday,dusk,golden', `post ${st.post}, times ${times.join(',')}`);
    await page.evaluate(() => window.__simDebug.setCam('chase'));
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
    await page.evaluate(() => window.__simStep(0.35));
    await shot(page, 'desktop-strike-impact', 0.05);
    await page.evaluate(() => window.__simStep(1.6));
    await shot(page, 'desktop-strike-replay', 0.05);
    await page.evaluate(() => window.__simStep(3.2));
    await shot(page, 'desktop-strike-chopper', 0.05);
    await page.evaluate(() => window.__simStep(4));
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
    const { page, ctx, errors } = await openSim(browser, opts, '?touch', { keepDispatch: true, keepTitle: true });
    await page.evaluate(() => window.__simStep(1));
    await shot(page, `${name}-title`);
    await page.evaluate(() => window.__simDebug.skipTitle());
    await shot(page, `${name}-dispatch`);
    await page.evaluate(() => window.__simDebug.reset({ z: 520 }));
    await page.evaluate(() => window.__simStep(2));
    await shot(page, `${name}-chase`);
    await page.evaluate(() => window.__simDebug.setCam('cockpit'));
    await shot(page, `${name}-cockpit`);
    await page.evaluate(() => window.__simDebug.setCam('chase'));
    if (name === 'phone-portrait') {
      // Drive with real multi-touch (CDP touch events): hold GAS, hold the right arrow
      // with a second finger (no dragging anywhere), then hold LOWER LOAD.
      const cdp = await ctx.newCDPSession(page);
      const centre = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }, sel);
      const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      await page.evaluate(() => window.__simDebug.reset({ z: 600 }));
      await page.evaluate(() => window.__simStep(1));
      const gas = await centre('.bs-gas'), right = await centre('.bs-right'), low = await centre('.bs-lowerbtn');
      await touch('touchStart', [{ x: gas.x, y: gas.y, id: 1 }]);
      let s = await page.evaluate(() => window.__simStep(4));
      const sp = s.speedKmh;
      const g = { x: gas.x, y: gas.y, id: 1 };
      const x0 = s.tractor.x;
      await touch('touchStart', [g, { x: right.x, y: right.y, id: 2 }]);
      s = await page.evaluate(() => window.__simStep(1.5));
      await touch('touchEnd', []);
      await touch('touchStart', [{ x: low.x, y: low.y, id: 3 }]);
      s = await page.evaluate(() => window.__simStep(1.5));
      await touch('touchEnd', []);
      check('touch: gas, right arrow and LOWER LOAD drive the rig', sp > 5 && s.tractor.x - x0 > 0.3 && s.lower > 0.99, `speed ${sp.toFixed(1)} km/h after 4 s, right arrow moved x +${(s.tractor.x - x0).toFixed(2)} m, lower ${s.lower.toFixed(2)}`);
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
