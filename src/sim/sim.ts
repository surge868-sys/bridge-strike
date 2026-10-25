// Main loop, cameras, input, HUD wiring and the test hooks.
import * as THREE from 'three';
import { initPhysics, createWorld, STEP, RAPIER } from './physics';
import { loadModel, loadTexture, loadFonts } from './assets';
import { buildWorld, LANES } from './world';
import { buildOverpass, Overpass, OverpassDef } from './bridges';
import { Rig, RigControls, TUNE } from './rig';
import { LOADS, LOWER_BY, LoadDef } from './loads';
import { UI } from './ui';

export interface SimOptions {
  container: HTMLElement;
  forceTouch?: boolean;
}

type Phase = 'drive' | 'strike' | 'rolled';
type CamMode = 'chase' | 'drone';

const START = { x: LANES[1].center, z: 760 };
// M1 has one overpass: Highway 16 at Circle Drive, the city's lowest (posted 4.7 m).
const OVERPASS: OverpassDef = { id: 'hwy16-circle', name: 'HWY 16 · CIRCLE DR', z: 0, kind: 'concrete', clearance: [4.7, 5.1] };

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 4000);

  const [, , tractor, trailer, wheel, concrete] = await Promise.all([
    initPhysics(),
    loadFonts(),
    loadModel('tractor'),
    loadModel('trailer'),
    loadModel('wheel'),
    loadTexture('textures/concrete.webp'),
  ]);
  const loadModels = new Map<string, THREE.Group>();
  const getLoad = async (def: LoadDef) => {
    if (!loadModels.has(def.model)) loadModels.set(def.model, await loadModel(def.model));
    return loadModels.get(def.model)!.clone();
  };

  const world = createWorld();
  const env = buildWorld(scene, world);
  const overpass: Overpass = buildOverpass(scene, world, OVERPASS, concrete);

  // Image-based lighting from the sky so chrome and paint have something to reflect.
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(env.sky.clone());
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1500, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6f6446 }));
    ground.position.y = -2;
    envScene.add(ground);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.8;
  }

  const ui = new UI(container, opts.forceTouch);
  const queue = new RAPIER.EventQueue(true);

  let loadIndex = 0;
  let rig!: Rig;
  let phase: Phase = 'drive';
  let simTime = 0;
  let timeScale = 1;
  let slowmo = 0;
  let rolledFor = 0;
  let cleared = false;
  let struck: { by: string; speedKmh: number; time: number } | null = null;
  let camMode: CamMode = 'chase';
  let hookInput: Partial<RigControls> | null = null;

  const reset = async (o: { load?: number; x?: number; z?: number } = {}) => {
    if (o.load !== undefined) loadIndex = o.load;
    rig?.destroy();
    const def = LOADS[loadIndex];
    rig = new Rig(world, scene, { tractor: tractor.clone(), trailer: trailer.clone(), wheel, load: await getLoad(def) }, def, { x: o.x ?? START.x, z: o.z ?? START.z });
    phase = 'drive';
    simTime = 0;
    timeScale = 1;
    slowmo = 0;
    rolledFor = 0;
    cleared = false;
    struck = null;
    ui.hideCard();
    snapCamera = true;
  };

  // --- input
  const keys = new Set<string>();
  let keySteer = 0;
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'KeyC') camMode = camMode === 'chase' ? 'drone' : 'chase';
    if (e.code === 'KeyR') void reset();
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  ui.onCam = () => (camMode = camMode === 'chase' ? 'drone' : 'chase');
  ui.onRestart = () => void reset();

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

  // --- fixed step
  const step = () => {
    const c = phase === 'drive' ? readControls(STEP) : { throttle: 0, brake: 1, steer: 0, lower: rig.controls.lower, jake: false };
    rig.setControls(c);
    const speedBefore = Math.abs(rig.speed()) * 3.6;
    rig.preStep(STEP);
    world.step(queue);
    simTime += STEP;

    queue.drainCollisionEvents((h1, h2, started) => {
      if (!started || phase !== 'drive') return;
      const other = h1 === rig.envelope.handle ? h2 : h2 === rig.envelope.handle ? h1 : rig.rigColliders.has(h1) ? h2 : rig.rigColliders.has(h2) ? h1 : -1;
      if (other < 0 || !overpass.strikeColliders.has(other)) return;
      const by = h1 === rig.envelope.handle || h2 === rig.envelope.handle ? 'load' : 'rig';
      struck = { by, speedKmh: speedBefore, time: simTime };
      phase = 'strike';
      slowmo = 2.0;
    });

    if (!rig.calibrated && simTime > 1.5 && Math.abs(rig.speed()) < 0.3 && rig.lower === 0) rig.calibrate();

    if (phase === 'drive') {
      const upT = rig.tractor.up().y, upR = rig.trailer.up().y;
      rolledFor = Math.min(upT, upR) < 0.3 ? rolledFor + STEP : 0;
      if (rolledFor > 0.5) {
        phase = 'rolled';
        ui.showRolled(rig.load);
      }
      const rear = rig.trailerBody.translation().z + 7.8;
      if (!cleared && rear < overpass.def.z - 7) {
        cleared = true;
        ui.showCleared('CLEARED!');
      }
    }
  };

  // --- camera
  let snapCamera = true;
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
    const frontZ = rig.tractorBody.translation().z - 4.4;
    const dist = frontZ - (overpass.def.z + 6);
    ui.update({
      speedKmh: rig.speed() * 3.6,
      load: rig.load,
      loadTop: rig.load.top - rig.lower * LOWER_BY,
      lowered: rig.lower,
      next: cleared || dist < -20 ? undefined : {
        name: overpass.def.name,
        distance: dist,
        lanes: overpass.spans.filter((s) => s.lane).map((s) => ({ name: s.lane!, clearance: s.clearance })),
        currentLane: currentLane(),
      },
    });
    renderer.render(scene, camera);
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
        ui.showStrike({ where: OVERPASS.name.replace(' · ', ' at '), speedKmh: struck.speedKmh, load: rig.load });
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

  await reset();

  // --- test hooks
  const state = () => {
    const tt = rig.tractorBody.translation(), tr = rig.trailerBody.translation();
    const x = tt.x;
    const q = rig.tractorBody.rotation();
    // heading: 0 when driving -z, positive when turning toward +x
    const fx = -(2 * (q.x * q.z + q.w * q.y)), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const heading = Math.atan2(fx, -fz);
    return {
      heading,
      phase, simTime, camMode,
      load: rig.load.name, loadTarget: rig.load.top,
      speedKmh: rig.speed() * 3.6,
      tractor: { x: tt.x, y: tt.y, z: tt.z, up: rig.tractor.up().y, contacts: rig.tractor.inContact() },
      trailer: { x: tr.x, y: tr.y, z: tr.z, up: rig.trailer.up().y, contacts: rig.trailer.inContact() },
      steer: rig.steerAngle, lower: rig.lower,
      loadTop: rig.loadTopAboveRoad(),
      calibrated: rig.calibrated, calibrationError: rig.calibrationError,
      lane: currentLane(), clearanceHere: overpass.clearanceAt(x),
      struck, cleared, rolled: phase === 'rolled',
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
  window.__simDebug = { rig: () => rig, world, scene, camera, renderer, TUNE, reset, setCam: (m: CamMode) => (camMode = m), overpass };

  requestAnimationFrame(frame);
  return { reset };
}
