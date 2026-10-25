// The articulated rig: tractor and trailer as separate dynamic bodies, each with
// its own ray-cast vehicle controller, joined at the kingpin.
import * as THREE from 'three';
import { RAPIER, G, groups, NONE, Vehicle, WheelSpec, SuspensionTune, groundHeight, localToWorld } from './physics';
import { DECK_TOP, LOAD_Z, LOWER_BY, LoadDef } from './loads';

export interface RigModels {
  tractor: THREE.Group;
  trailer: THREE.Group;
  wheel: THREE.Group;
  load: THREE.Group;
}

export interface RigControls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  lower: boolean;
  jake: boolean;
}

// Tractor body space == tractor model space (forward -z, ground at y=0 when unloaded).
const TRACTOR_WHEELS: WheelSpec[] = [
  { name: 'FL', x: -1.03, y: 0.56, z: -3.5, r: 0.527, axle: 0, steer: true },
  { name: 'FR', x: 1.03, y: 0.56, z: -3.5, r: 0.527, axle: 0, steer: true },
  { name: 'D1L', x: -0.93, y: 0.56, z: 2.195, r: 0.527, axle: 1, drive: true },
  { name: 'D1R', x: 0.93, y: 0.56, z: 2.195, r: 0.527, axle: 1, drive: true },
  { name: 'D2L', x: -0.93, y: 0.56, z: 3.6, r: 0.527, axle: 2, drive: true },
  { name: 'D2R', x: 0.93, y: 0.56, z: 3.6, r: 0.527, axle: 2, drive: true },
];
const TRAILER_WHEELS: WheelSpec[] = [3.46, 4.83, 6.2].flatMap((z, a) => [
  { name: `A${a + 1}L`, x: -0.99, y: 0.5, z, r: 0.5, axle: a },
  { name: `A${a + 1}R`, x: 0.99, y: 0.5, z, r: 0.5, axle: a },
]);
const DUAL = 0.165; // half spacing of dual tires
const WHEELBASE = 6.4;
const FIFTH_WHEEL = { x: 0, y: 1.36, z: 2.7 }; // tractor space
const KINGPIN = { x: 0, y: 1.3, z: -7.0 }; // trailer space

export const TUNE = {
  tractor: {
    rest: 0.32, travel: 0.22, stiffness: 46, compression: 4.2, relaxation: 5.0,
    maxForce: 1e7, frictionSlip: 1.05, sideStiffness: 1.0, antiRoll: 60, antiRollDamping: 1.5,
  } as SuspensionTune,
  trailer: {
    rest: 0.32, travel: 0.22, stiffness: 15, compression: 2.2, relaxation: 2.8,
    maxForce: 1e7, frictionSlip: 1.05, sideStiffness: 1.0, antiRoll: 50, antiRollDamping: 1.5,
  } as SuspensionTune,
  driveForce: 9000, // N per drive wheel ray (4 rays)
  reverseForce: 5000,
  topSpeed: 100 / 3.6,
  brake: 170, // impulse per step per wheel at full pedal (~3.3 m/s^2 loaded)
  jake: 40, // extra drive-axle impulse per step
  holdBrake: 20, // keeps a stopped rig from creeping
  maxLock: 0.6,
  lateralG: 0.45,
  steerRate: 1.6, // rad/s
  lowerTime: 1.2,
};

const rigGroup = (member: number) => groups(member, G.GROUND | G.DECK | G.PIER);

export class Rig {
  tractorBody: RAPIER.RigidBody;
  trailerBody: RAPIER.RigidBody;
  tractor: Vehicle;
  trailer: Vehicle;
  joint: RAPIER.ImpulseJoint;
  envelope: RAPIER.Collider;
  rigColliders = new Set<number>();

  tractorGroup = new THREE.Group();
  trailerGroup = new THREE.Group();
  loadGroup = new THREE.Group();
  deckNode: THREE.Object3D | null = null;
  wheelMeshes: { obj: THREE.Object3D; vehicle: Vehicle; i: number; offset: number; flip: boolean }[] = [];
  rams: { rod: THREE.Mesh }[] = [];

  steerAngle = 0;
  lower = 0; // 0 = up, 1 = fully lowered
  loadOffsetY = 0; // calibration offset
  calibrated = false;
  calibrationError = 0;
  loadSize = new THREE.Vector3();
  loadCenter = new THREE.Vector3();
  controls: RigControls = { throttle: 0, brake: 0, steer: 0, lower: false, jake: false };

  constructor(
    readonly world: RAPIER.World,
    readonly scene: THREE.Scene,
    models: RigModels,
    readonly load: LoadDef,
    start: { x: number; z: number },
  ) {
    const y0 = groundHeight(world, start.x, start.z) + 0.05;

    // --- tractor
    this.tractorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(start.x, y0, start.z).setCanSleep(false).setAngularDamping(0.2),
    );
    this.addCollider(this.tractorBody, RAPIER.ColliderDesc.cuboid(1.22, 0.75, 4.3).setTranslation(0, 1.75, 0).setMass(1800));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.9, 0.25, 3.8).setTranslation(0, 0.85, -0.2).setMass(7200).setCollisionGroups(NONE),
      this.tractorBody,
    );
    this.tractor = new Vehicle(world, this.tractorBody, TRACTOR_WHEELS, TUNE.tractor);

    // --- trailer, placed so the kingpin sits on the fifth wheel
    const tz = start.z + FIFTH_WHEEL.z - KINGPIN.z;
    this.trailerBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(start.x, y0 + FIFTH_WHEEL.y - KINGPIN.y, tz).setCanSleep(false).setAngularDamping(0.2),
    );
    this.addCollider(this.trailerBody, RAPIER.ColliderDesc.cuboid(1.25, 0.18, 1.85).setTranslation(0, 1.42, -5.9).setMass(1500));
    this.addCollider(this.trailerBody, RAPIER.ColliderDesc.cuboid(1.25, 0.14, 3.75).setTranslation(0, 0.56, -1.1).setMass(4000));
    this.addCollider(this.trailerBody, RAPIER.ColliderDesc.cuboid(1.25, 0.22, 2.55).setTranslation(0, 0.98, 5.2).setMass(3500));
    // Most of the load's mass rides low as ballast that collides with nothing.
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.9, 0.3, 2.4).setTranslation(0, DECK_TOP + 0.45, LOAD_Z).setMass(load.mass).setCollisionGroups(NONE),
      this.trailerBody,
    );
    this.trailer = new Vehicle(world, this.trailerBody, TRAILER_WHEELS, TUNE.trailer);

    // --- load envelope: light, only there to detect strikes
    const box = new THREE.Box3().setFromObject(models.load);
    box.getSize(this.loadSize);
    box.getCenter(this.loadCenter);
    this.envelope = world.createCollider(
      RAPIER.ColliderDesc.cuboid(this.loadSize.x / 2, this.loadSize.y / 2, this.loadSize.z / 2)
        .setTranslation(this.loadCenter.x, this.envelopeY(), LOAD_Z + this.loadCenter.z)
        .setMass(50)
        .setFriction(0.2)
        .setCollisionGroups(groups(G.LOAD, G.DECK | G.PIER))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.trailerBody,
    );

    // --- kingpin
    this.joint = world.createImpulseJoint(RAPIER.JointData.spherical(FIFTH_WHEEL, KINGPIN), this.tractorBody, this.trailerBody, true);
    this.joint.setContactsEnabled(false);

    this.buildVisuals(models);
  }

  private addCollider(body: RAPIER.RigidBody, desc: RAPIER.ColliderDesc) {
    const c = this.world.createCollider(
      desc.setCollisionGroups(rigGroup(G.RIG)).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS).setFriction(0.6),
      body,
    );
    this.rigColliders.add(c.handle);
    return c;
  }

  private envelopeY() {
    return DECK_TOP + this.loadOffsetY - this.lower * LOWER_BY + this.loadSize.y / 2;
  }

  private buildVisuals(models: RigModels) {
    const shadow = (o: THREE.Object3D) => o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    // Generated paint reads too metallic under the sun; ease it off.
    const tame = (o: THREE.Object3D, metal: number) => o.traverse((m) => {
      const mat = (m as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat && 'metalness' in mat) { mat.metalness = Math.min(mat.metalness, metal); mat.envMapIntensity = 0.9; }
    });
    this.tractorGroup.add(models.tractor);
    tame(models.tractor, 0.75);
    shadow(models.tractor);
    this.trailerGroup.add(models.trailer);
    tame(models.trailer, 0.4);
    shadow(models.trailer);
    this.deckNode = models.trailer.getObjectByName('deck') ?? null;
    this.loadGroup.add(models.load);
    tame(models.load, 0.6);
    shadow(models.load);
    this.trailerGroup.add(this.loadGroup);
    this.buildBogie();
    this.scene.add(this.tractorGroup, this.trailerGroup);

    const addWheels = (vehicle: Vehicle, group: THREE.Group, duals: (w: WheelSpec) => number[], scale: number) => {
      vehicle.wheels.forEach((w, i) => {
        for (const offset of duals(w)) {
          const obj = models.wheel.clone();
          obj.scale.setScalar(scale);
          obj.rotation.order = 'YXZ';
          shadow(obj);
          group.add(obj);
          this.wheelMeshes.push({ obj, vehicle, i, offset, flip: w.x > 0 });
        }
      });
    };
    addWheels(this.tractor, this.tractorGroup, (w) => (w.drive ? [-DUAL, DUAL] : [0]), 1);
    addWheels(this.trailer, this.trailerGroup, () => [-DUAL, DUAL], 0.95);
  }

  /** Rear bogie, tail and hydraulic rams: procedural so the rams can animate. */
  private buildBogie() {
    const steel = new THREE.MeshStandardMaterial({ color: 0x2c2c2e, roughness: 0.6, metalness: 0.35 });
    const plank = new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 0.85, metalness: 0 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.12, metalness: 1 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe0a800, roughness: 0.45, metalness: 0.2 });
    const red = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2200, emissiveIntensity: 1.2 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.trailerGroup.add(mesh);
      return mesh;
    };
    for (const s of [-1, 1]) box(0.22, 0.34, 5.2, s * 0.95, 0.98, 5.15, steel); // side beams
    box(2.56, 0.08, 5.2, 0, 1.18, 5.15, plank); // platform, weathered planks like the well deck
    box(2.56, 0.5, 0.22, 0, 0.93, 2.72, steel); // riser at the end of the well
    box(2.6, 0.3, 0.2, 0, 0.92, 7.72, steel); // tail beam
    for (const s of [-1, 1]) {
      box(0.18, 0.08, 0.04, s * 1.0, 0.98, 7.83, red);
      box(0.5, 0.62, 0.03, s * 0.99, 0.5, 6.85, steel); // mud flaps
    }
    // Rams: barrel fixed to the gooseneck / riser, rod down to the deck.
    for (const [x, z, top] of [[-1.05, -4.25, 1.25], [1.05, -4.25, 1.25], [-1.05, 2.45, 1.15], [1.05, 2.45, 1.15]]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.32, 14), yellow);
      barrel.position.set(x, top - 0.16, z);
      barrel.castShadow = true;
      this.trailerGroup.add(barrel);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 10).translate(0, -0.5, 0), chrome);
      rod.position.set(x, top - 0.32, z);
      rod.userData.top = top - 0.32;
      this.trailerGroup.add(rod);
      this.rams.push({ rod });
    }
  }

  setControls(c: Partial<RigControls>) {
    Object.assign(this.controls, c);
  }

  speed() {
    return this.tractor.speed();
  }

  maxSteer(v: number) {
    // Lock shrinks with speed so full lock stays near 0.45 g lateral.
    const v2 = Math.max(v * v, 1);
    return Math.min(TUNE.maxLock, Math.atan((WHEELBASE * TUNE.lateralG * 9.81) / v2));
  }

  preStep(dt: number) {
    const c = this.controls;
    const v = this.speed();

    // steering, rate-limited, positive steer = turn right (toward +x when heading -z)
    const target = -c.steer * this.maxSteer(Math.abs(v));
    const d = target - this.steerAngle;
    this.steerAngle += Math.sign(d) * Math.min(Math.abs(d), TUNE.steerRate * dt);
    this.tractor.setSteer(this.steerAngle);

    // drive / brake. Brake held while stopped engages reverse.
    let drive = 0, brake = 0;
    if (c.throttle > 0) {
      const taper = THREE.MathUtils.clamp((TUNE.topSpeed - v) / 3, 0, 1);
      drive = c.throttle * TUNE.driveForce * taper;
    }
    if (c.brake > 0) {
      if (v > 0.8) brake = c.brake * TUNE.brake;
      else drive = -c.brake * TUNE.reverseForce * THREE.MathUtils.clamp((4 + v) / 2, 0, 1);
    }
    const parked = c.throttle === 0 && c.brake === 0 && Math.abs(v) < 0.4;
    if (parked) {
      brake = TUNE.holdBrake;
      // The coupled rig creeps ~5 cm/s from kingpin joint drift that no brake
      // impulse removes; hold it still while parked.
      for (const b of [this.tractorBody, this.trailerBody]) {
        const lv = b.linvel();
        b.setLinvel({ x: 0, y: lv.y, z: 0 }, true);
      }
    }
    const jake = c.jake && v > 1 ? TUNE.jake : 0;
    this.tractor.setDrive(drive);
    this.tractor.setBrake(brake, jake);
    this.trailer.setBrake(brake);

    // hold-to-lower on the hydraulics
    const goal = c.lower ? 1 : 0;
    if (this.lower !== goal) {
      const step = dt / TUNE.lowerTime;
      this.lower = goal > this.lower ? Math.min(1, this.lower + step) : Math.max(0, this.lower - step);
      this.envelope.setTranslationWrtParent({ x: this.loadCenter.x, y: this.envelopeY(), z: LOAD_Z + this.loadCenter.z });
    }

    this.tractor.preStep(dt);
    this.trailer.preStep(dt);
  }

  /** Top of the load envelope above the road under it. */
  loadTopAboveRoad() {
    const top = localToWorld(this.trailerBody, { x: this.loadCenter.x, y: this.envelopeY() + this.loadSize.y / 2, z: LOAD_Z + this.loadCenter.z });
    return top.y - groundHeight(this.world, top.x, top.z);
  }

  /** After the suspension settles, put the envelope top exactly at the posted load height. */
  calibrate() {
    if (this.calibrated) return;
    const err = this.loadTopAboveRoad() - (this.load.top - this.lower * LOWER_BY);
    this.loadOffsetY -= err;
    this.calibrationError = err;
    this.envelope.setTranslationWrtParent({ x: this.loadCenter.x, y: this.envelopeY(), z: LOAD_Z + this.loadCenter.z });
    this.calibrated = true;
  }

  /** Copy physics state to the visuals. */
  sync() {
    for (const [body, group] of [[this.tractorBody, this.tractorGroup], [this.trailerBody, this.trailerGroup]] as const) {
      const t = body.translation(), q = body.rotation();
      group.position.set(t.x, t.y, t.z);
      group.quaternion.set(q.x, q.y, q.z, q.w);
    }
    const drop = this.lower * LOWER_BY;
    if (this.deckNode) this.deckNode.position.y = -drop;
    this.loadGroup.position.set(0, DECK_TOP + this.loadOffsetY - drop, LOAD_Z);
    for (const { rod } of this.rams) rod.scale.y = Math.max(0.02, rod.userData.top - (DECK_TOP - drop));

    for (const w of this.wheelMeshes) {
      const ctl = w.vehicle.ctl;
      const hp = ctl.wheelChassisConnectionPointCs(w.i)!;
      const len = ctl.wheelSuspensionLength(w.i) ?? w.vehicle.tune.rest;
      const spec = w.vehicle.wheels[w.i];
      w.obj.position.set(hp.x + Math.sign(spec.x) * w.offset, hp.y - len, hp.z);
      const steer = ctl.wheelSteering(w.i) ?? 0;
      const spin = ctl.wheelRotation(w.i) ?? 0;
      w.obj.rotation.set(w.flip ? -spin : spin, steer + (w.flip ? Math.PI : 0), 0);
    }
  }

  destroy() {
    this.world.removeVehicleController(this.tractor.ctl);
    this.world.removeVehicleController(this.trailer.ctl);
    this.world.removeRigidBody(this.trailerBody);
    this.world.removeRigidBody(this.tractorBody);
    this.scene.remove(this.tractorGroup, this.trailerGroup);
  }
}
