// Main loop, cameras, input, HUD wiring and the test hooks.
import * as THREE from 'three';
import { initPhysics, createWorld, STEP, RAPIER } from './physics';
import { loadModel, loadTexture, loadFonts } from './assets';
import { buildWorld, buildCityLimits, LANES } from './world';
import { buildOverpass, Overpass, ROUTE, START_Z, DELIVERY_Z } from './bridges';
import { Rig, RigControls, TUNE } from './rig';
import { LOADS, LOWER_BY, LoadDef } from './loads';
import { UI } from './ui';
import { buildScenery } from './scenery';
import { createPost } from './post';
import { TIMES, timeById, TimeOfDay } from './timeofday';

export interface SimOptions {
  container: HTMLElement;
  forceTouch?: boolean;
}

type Phase = 'dispatch' | 'drive' | 'strike' | 'rolled' | 'delivered';
type CamMode = 'chase' | 'cockpit' | 'drone';
const CAMS: CamMode[] = ['chase', 'cockpit', 'drone'];
// Driver-side hood view in tractor space: just ahead of the windscreen (the generated
// cab glass is opaque), 0.45 m above the long hood, which stays in frame.
const COCKPIT_EYE = new THREE.Vector3(-0.35, 2.6, -2.8);

const START = { x: LANES[1].center, z: START_Z };
const TRAILER_REAR = 7.8; // trailer rear in trailer space (+z)
const TRACTOR_FRONT = 4.4;
const ROLL_KMH = 60; // runs start already moving
const PROGRESS_KEY = 'bridge-strike:delivered';
const TIME_KEY = 'bridge-strike:time';

// Unlocks are a per-viewer convenience; storage can be missing or throw.
const readProgress = () => {
  try { return Math.max(0, Math.min(LOADS.length, parseInt(localStorage.getItem(PROGRESS_KEY) ?? '0', 10) || 0)); } catch { return 0; }
};
const saveProgress = (n: number) => {
  try { localStorage.setItem(PROGRESS_KEY, String(n)); } catch { /* ignore */ }
};
const readTime = (): TimeOfDay => {
  try { return timeById((localStorage.getItem(TIME_KEY) ?? 'golden') as TimeOfDay).id; } catch { return 'golden'; }
};
const saveTime = (t: TimeOfDay) => {
  try { localStorage.setItem(TIME_KEY, t); } catch { /* ignore */ }
};

declare global {
  interface Window {
    __sim?: () => unknown;
    __simInput?: (c: Partial<RigControls> | null) => void;
    __simStep?: (secs: number) => unknown;
    __simPause?: (paused: boolean) => void;
    __simFrame?: (dt: number, snap?: boolean) => string | undefined;
    __simDebug?: Record<string, unknown>;
  }
}

export async function startSim(opts: SimOptions) {
  const { container } = opts;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  // Phones get a slightly lower ceiling: the post stack runs at full resolution.
  const coarse = opts.forceTouch || matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 4000);

  const tx = (n: string) => loadTexture(`textures/${n}.webp`);
  const [, , tractor, trailer, wheel, concrete, steel, asphalt, gravel, grass, stubble, tree, shelterbelt, farmyard, skyline] = await Promise.all([
    initPhysics(),
    loadFonts(),
    loadModel('tractor'),
    loadModel('trailer'),
    loadModel('wheel'),
    tx('concrete'),
    tx('rail-steel'),
    tx('asphalt'),
    tx('gravel'),
    tx('grass'),
    tx('stubble'),
    tx('tree'),
    tx('shelterbelt'),
    tx('farmyard'),
    tx('skyline'),
  ]);
  const loadModels = new Map<string, THREE.Group>();
  const getLoad = async (def: LoadDef) => {
    if (!loadModels.has(def.model)) loadModels.set(def.model, await loadModel(def.model));
    return loadModels.get(def.model)!.clone();
  };

  const world = createWorld();
  const overpassZ = ROUTE.map((d) => d.z);
  const env = buildWorld(scene, world, { asphalt, gravel, grass, stubble }, overpassZ);
  const scenery = buildScenery(scene, { tree, shelterbelt, farmyard, skyline }, overpassZ);
  const overpasses: Overpass[] = ROUTE.map((def) => buildOverpass(scene, world, def, { concrete, steel, grass }));
  buildCityLimits(scene, DELIVERY_Z);
  const post = createPost(renderer, scene, camera);

  // Headlights: a spot that follows the tractor, plus emissive lenses for the bloom.
  const headlight = new THREE.SpotLight(0xfff1d6, 0, 160, 0.42, 0.55, 1.2);
  headlight.castShadow = false;
  scene.add(headlight, headlight.target);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff3dc, emissiveIntensity: 0 });
  const lensGeo = new THREE.CircleGeometry(0.13, 16).rotateY(Math.PI);
  const attachLenses = () => {
    for (const x of [-0.92, 0.92]) {
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.set(x, 1.05, -4.36);
      rig.tractorGroup.add(lens);
    }
  };

  // Image-based lighting from the sky so chrome and paint have something to reflect;
  // rebuilt whenever the time of day changes.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envGround = new THREE.MeshBasicMaterial({ color: 0x6f6446 });
  const rebuildEnvironment = () => {
    const envScene = new THREE.Scene();
    envScene.add(env.sky.clone());
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1500, 32).rotateX(-Math.PI / 2), envGround);
    ground.position.y = -2;
    envScene.add(ground);
    const old = scene.environment;
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    old?.dispose();
  };
  let timeOfDay: TimeOfDay = readTime();
  const setTime = (id: TimeOfDay) => {
    const p = timeById(id);
    timeOfDay = p.id;
    env.apply(p);
    scenery.apply(p);
    post?.apply(p);
    renderer.toneMappingExposure = p.exposure;
    scene.environmentIntensity = p.envIntensity;
    envGround.color.set(p.envGround);
    headlight.intensity = 260 * p.headlights;
    lensMat.emissiveIntensity = 6 * p.headlights;
    rebuildEnvironment();
    saveTime(p.id);
  };
  setTime(timeOfDay);
  const cycleTime = () => setTime(TIMES[(TIMES.findIndex((t) => t.id === timeOfDay) + 1) % TIMES.length].id);

  const ui = new UI(container, opts.forceTouch);
  const queue = new RAPIER.EventQueue(true);

  let loadIndex = 0;
  let rig!: Rig;
  let phase: Phase = 'dispatch';
  let simTime = 0;
  let driveTime = 0;
  let timeScale = 1;
  let slowmo = 0;
  let rolledFor = 0;
  let cleared = 0; // overpasses passed this run
  let lowerings = 0;
  let wasLowering = false;
  let topSpeed = 0;
  let struck: { by: string; at: string; speedKmh: number; time: number } | null = null;
  let camMode: CamMode = 'chase';
  let hookInput: Partial<RigControls> | null = null;
  let snapCamera = true;

  // Let the springs take the weight and calibrate the envelope before the run starts,
  // so a rolling start never has to wait for the rig to sit still.
  const settle = () => {
    rig.setControls({ throttle: 0, brake: 0, steer: 0, lower: false, jake: false }); // parked: hold brake + creep clamp
    for (let i = 0; i < 180; i++) { rig.preStep(STEP); world.step(queue); }
    queue.drainCollisionEvents(() => {});
    rig.calibrate();
  };

  const reset = async (o: { load?: number; x?: number; z?: number; phase?: Phase; rolling?: boolean } = {}) => {
    if (o.load !== undefined) loadIndex = o.load;
    rig?.destroy();
    const def = LOADS[loadIndex];
    rig = new Rig(world, scene, { tractor: tractor.clone(), trailer: trailer.clone(), wheel, load: await getLoad(def) }, def, { x: o.x ?? START.x, z: o.z ?? START.z });
    attachLenses();
    settle();
    if (o.rolling) rig.launch(ROLL_KMH / 3.6);
    phase = o.phase ?? 'drive';
    simTime = driveTime = 0;
    timeScale = 1;
    slowmo = rolledFor = lowerings = topSpeed = 0;
    // Overpasses already behind the start point count as cleared (tests start mid-route).
    cleared = overpasses.filter((op) => op.def.z - op.halfZ > (o.z ?? START.z) + TRAILER_REAR + 9.7).length;
    wasLowering = false;
    struck = null;
    ui.hideCard();
    snapCamera = true;
  };

  const openDispatch = (selected = Math.min(readProgress(), LOADS.length - 1)) => {
    ui.showDispatch({
      loads: LOADS,
      unlocked: Math.min(readProgress(), LOADS.length - 1),
      selected,
      times: TIMES.map((t) => ({ id: t.id, label: t.label })),
      time: timeOfDay,
      onTime: (t) => setTime(t as TimeOfDay),
      onRoll: async (i) => {
        if (i !== loadIndex || phase !== 'dispatch') await reset({ load: i, phase: 'dispatch' });
        phase = 'drive';
        rig.launch(ROLL_KMH / 3.6);
        ui.toast(`ROLLING · ${ROLL_KMH} km/h`);
        focusGame();
      },
    });
  };

  const cycleCam = () => {
    camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length];
    snapCamera = true;
  };

  // --- input
  const keys = new Set<string>();
  let keySteer = 0;
  const focusGame = () => { try { window.focus(); renderer.domElement.focus({ preventScroll: true }); } catch { /* ignore */ } };
  container.addEventListener('pointerdown', focusGame);
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (phase === 'dispatch' && ['Enter', 'Space', 'KeyW', 'ArrowUp'].includes(e.code)) ui.rollOut();
    if (phase === 'dispatch' && ['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(e.code)) ui.dispatchMove?.(e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : 1);
    if (e.code === 'KeyC') cycleCam();
    if (e.code === 'KeyT') { cycleTime(); ui.toast(timeById(timeOfDay).label); }
    if (e.code === 'KeyR' && phase !== 'dispatch') void reset({ rolling: true });
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  ui.onCam = () => cycleCam();
  ui.onRestart = () => void reset({ rolling: true });
  ui.onDispatch = (next) => { void reset({ load: next ?? loadIndex, phase: 'dispatch' }).then(() => openDispatch(next ?? loadIndex)); };

  const readControls = (dt: number): RigControls => {
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = target === 0 ? 4 : 2.5;
    keySteer += THREE.MathUtils.clamp(target - keySteer, -rate * dt, rate * dt);
    const t = ui.touch;
    const c: RigControls = {
      throttle: Math.max(keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0, t.gas),
      brake: Math.max(keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0, t.brake),
      steer: THREE.MathUtils.clamp(keySteer + t.steer, -1, 1),
      lower: keys.has('Space') || t.lower,
      jake: keys.has('KeyJ') || t.jake,
    };
    return hookInput ? { ...c, ...hookInput } : c;
  };

  const trailerRear = () => rig.trailerBody.translation().z + TRAILER_REAR;
  const nextOverpass = () => overpasses.find((op) => trailerRear() > op.def.z - op.halfZ - 1);

  // --- fixed step
  const step = () => {
    const parked = { throttle: 0, brake: phase === 'dispatch' ? 0 : 1, steer: 0, lower: false, jake: false };
    const c = phase === 'drive' ? readControls(STEP) : { ...parked, lower: phase === 'dispatch' ? false : rig.controls.lower };
    rig.setControls(c);
    const speedBefore = Math.abs(rig.speed()) * 3.6;
    rig.preStep(STEP);
    world.step(queue);
    simTime += STEP;

    queue.drainCollisionEvents((h1, h2, started) => {
      if (!started || phase !== 'drive') return;
      const env1 = h1 === rig.envelope.handle, env2 = h2 === rig.envelope.handle;
      const other = env1 ? h2 : env2 ? h1 : rig.rigColliders.has(h1) ? h2 : rig.rigColliders.has(h2) ? h1 : -1;
      const op = other < 0 ? undefined : overpasses.find((o) => o.strikeColliders.has(other));
      if (!op) return;
      struck = { by: env1 || env2 ? 'load' : 'rig', at: op.def.id, speedKmh: speedBefore, time: simTime };
      phase = 'strike';
      slowmo = 2.0;
    });

    if (!rig.calibrated && simTime > 1.5 && Math.abs(rig.speed()) < 0.3 && rig.lower === 0) rig.calibrate();

    if (phase === 'drive') {
      driveTime += STEP;
      topSpeed = Math.max(topSpeed, speedBefore);
      if (c.lower && !wasLowering) lowerings++;
      wasLowering = c.lower;
      const upT = rig.tractor.up().y, upR = rig.trailer.up().y;
      rolledFor = Math.min(upT, upR) < 0.3 ? rolledFor + STEP : 0;
      if (rolledFor > 0.5) {
        phase = 'rolled';
        ui.showRolled(rig.load);
      }
      const rear = trailerRear();
      while (cleared < overpasses.length && rear < overpasses[cleared].def.z - overpasses[cleared].halfZ - 1) {
        ui.showCleared(`CLEARED · ${overpasses[cleared].def.name}`);
        cleared++;
      }
      if (phase === 'drive' && cleared === overpasses.length && rear < DELIVERY_Z) {
        phase = 'delivered';
        if (loadIndex + 1 > readProgress()) saveProgress(loadIndex + 1);
        ui.showDelivered({ load: rig.load, time: driveTime, lowerings, topSpeed, next: LOADS[loadIndex + 1], nextIndex: loadIndex + 1 });
      }
    }
  };

  // --- camera
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const updateCamera = (dt: number) => {
    const t = rig.tractorBody.translation();
    const q = rig.tractorBody.rotation();
    const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    fwd.y = 0;
    fwd.normalize();
    const base = new THREE.Vector3(t.x, t.y, t.z);
    let want: THREE.Vector3, look: THREE.Vector3;
    if (camMode === 'cockpit') {
      // Locked to the cab: the view pitches and rolls with the tractor.
      camera.position.copy(COCKPIT_EYE).applyQuaternion(quat).add(base);
      camera.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.06));
      if (camera.near !== 0.12) { camera.near = 0.12; camera.updateProjectionMatrix(); }
      camPos.copy(camera.position);
      camLook.copy(base).addScaledVector(fwd, 20);
      snapCamera = false;
      return;
    }
    if (camera.near !== 0.3) { camera.near = 0.3; camera.updateProjectionMatrix(); }
    if (camMode === 'chase') {
      want = base.clone().addScaledVector(fwd, -27).add(new THREE.Vector3(0, 8.5, 0));
      look = base.clone().addScaledVector(fwd, 14).add(new THREE.Vector3(0, 2.6, 0));
    } else {
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      want = base.clone().addScaledVector(fwd, -10).addScaledVector(side, -24).add(new THREE.Vector3(0, 30, 0));
      look = base.clone().addScaledVector(fwd, 8);
    }
    const k = snapCamera ? 1 : 1 - Math.exp(-dt * 4);
    camPos.lerp(want, k);
    camLook.lerp(look, snapCamera ? 1 : 1 - Math.exp(-dt * 6));
    snapCamera = false;
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  };

  const resize = () => {
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    post?.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 68 : 55; // portrait phones need more vertical view
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const currentLane = () => {
    const x = rig.tractorBody.translation().x;
    return LANES.find((l) => x >= l.min && x <= l.max)?.name ?? null;
  };

  const render = (dt: number) => {
    rig.sync();
    updateCamera(dt);
    env.update(camera, rig.tractorGroup.position);
    scenery.update(camera);
    if (headlight.intensity > 0) {
      const tq = rig.tractorGroup.quaternion;
      headlight.position.set(0, 1.3, -4.6).applyQuaternion(tq).add(rig.tractorGroup.position);
      headlight.target.position.set(0, 0, -40).applyQuaternion(tq).add(rig.tractorGroup.position);
    }
    const frontZ = rig.tractorBody.translation().z - TRACTOR_FRONT;
    const op = nextOverpass();
    ui.update({
      speedKmh: rig.speed() * 3.6,
      load: rig.load,
      loadTop: rig.load.top - rig.lower * LOWER_BY,
      lowered: rig.lower,
      next: op
        ? {
            title: `OVERPASS ${overpasses.indexOf(op) + 1} OF ${overpasses.length}`,
            name: op.def.name,
            distance: frontZ - (op.def.z + op.halfZ),
            lanes: op.spans.filter((s) => s.lane).map((s) => ({ name: s.lane!, clearance: s.clearance })),
            currentLane: currentLane(),
          }
        : { title: 'DELIVERY', name: 'SASKATOON CITY LIMITS', distance: frontZ - DELIVERY_Z, lanes: [], currentLane: null },
    });
    if (post) post.render(); else renderer.render(scene, camera);
  };

  // --- loop
  let paused = false;
  let acc = 0;
  let last = performance.now();
  const advance = (realDt: number) => {
    if (slowmo > 0) {
      slowmo -= realDt;
      timeScale = 0.2;
      if (slowmo <= 0 && struck) {
        timeScale = 1;
        const op = overpasses.find((o) => o.def.id === struck!.at)!;
        ui.showStrike({ where: op.def.name, kind: op.def.kind, speedKmh: struck.speedKmh, load: rig.load });
      }
    }
    acc += realDt * timeScale;
    let n = 0;
    while (acc >= STEP && n < 24) { step(); acc -= STEP; n++; }
    if (n === 24) acc = 0;
  };
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // While paused (tests), frames render only on demand through __simFrame.
    if (!paused) { advance(dt); render(dt); }
    requestAnimationFrame(frame);
  };

  await reset({ load: 0, phase: 'dispatch' });
  openDispatch(0);

  // --- test hooks
  const state = () => {
    const tt = rig.tractorBody.translation(), tr = rig.trailerBody.translation();
    const q = rig.tractorBody.rotation();
    // heading: 0 when driving -z, positive when turning toward +x
    const fx = -(2 * (q.x * q.z + q.w * q.y)), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const op = nextOverpass();
    return {
      heading: Math.atan2(fx, -fz),
      phase, simTime, driveTime, camMode, timeOfDay, post: !!post,
      loadIndex, load: rig.load.name, loadTarget: rig.load.top,
      speedKmh: rig.speed() * 3.6,
      tractor: { x: tt.x, y: tt.y, z: tt.z, up: rig.tractor.up().y, contacts: rig.tractor.inContact() },
      trailer: { x: tr.x, y: tr.y, z: tr.z, up: rig.trailer.up().y, contacts: rig.trailer.inContact(), rear: tr.z + TRAILER_REAR },
      steer: rig.steerAngle, lower: rig.lower, lowerings,
      loadTop: rig.loadTopAboveRoad(),
      calibrated: rig.calibrated, calibrationError: rig.calibrationError,
      lane: currentLane(),
      next: op ? { id: op.def.id, z: op.def.z, halfZ: op.halfZ, lanes: op.spans.filter((s) => s.lane).map((s) => ({ lane: s.lane, clearance: s.clearance, min: s.min, max: s.max })) } : null,
      cleared, struck, rolled: phase === 'rolled', delivered: phase === 'delivered',
    };
  };
  window.__sim = state;
  window.__simInput = (c) => { hookInput = c; };
  window.__simStep = (secs) => {
    const n = Math.round(secs / STEP);
    for (let i = 0; i < n; i++) {
      if (slowmo > 0) advance(STEP); else step();
    }
    return state();
  };
  window.__simPause = (p) => { paused = p; };
  window.__simFrame = (dt, snap) => {
    advance(dt);
    render(dt);
    return snap ? renderer.domElement.toDataURL('image/jpeg', 0.85) : undefined;
  };
  window.__simDebug = {
    rig: () => rig, world, scene, camera, renderer, TUNE, overpasses, LOADS,
    reset, setCam: (m: CamMode) => { camMode = m; snapCamera = true; }, setTime,
    clearProgress: () => saveProgress(0),
  };

  requestAnimationFrame(frame);
  return { reset };
}
