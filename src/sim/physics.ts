// Rapier world, collision groups and the ray-cast vehicle wrapper used for both
// the tractor and the trailer.
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

export const STEP = 1 / 120;

// Collision group bits. Rig parts never collide with each other; the ballast
// colliders carry mass only and collide with nothing.
export const G = {
  GROUND: 1 << 0,
  DECK: 1 << 1,
  PIER: 1 << 2,
  RIG: 1 << 3,
  LOAD: 1 << 4,
} as const;

export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const NONE = groups(0, 0);
// Wheel rays only see the ground: dynamic bodies are excluded by flag, decks by group.
const GROUND_QUERY = groups(0xffff, G.GROUND);

let ready: Promise<void> | null = null;
export function initPhysics() {
  ready ??= RAPIER.init();
  return ready;
}

export function createWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  world.numSolverIterations = 8;
  return world;
}

export interface WheelSpec {
  name: string;
  x: number;
  y: number; // hub height in body space at rest
  z: number;
  r: number;
  axle: number; // axle index; wheels sharing it get an anti-roll bar
  steer?: boolean;
  drive?: boolean;
}

export interface SuspensionTune {
  rest: number;
  travel: number;
  stiffness: number;
  compression: number;
  relaxation: number;
  maxForce: number;
  frictionSlip: number;
  sideStiffness: number;
  antiRoll: number; // N per metre of left/right compression difference
}

const UP = { x: 0, y: -1, z: 0 }; // suspension ray direction
const AXLE = { x: 1, y: 0, z: 0 }; // +x axle so positive engine force drives toward -z

export class Vehicle {
  readonly ctl: RAPIER.DynamicRayCastVehicleController;
  readonly axles: [number, number][] = [];

  constructor(
    world: RAPIER.World,
    readonly body: RAPIER.RigidBody,
    readonly wheels: WheelSpec[],
    readonly tune: SuspensionTune,
  ) {
    this.ctl = world.createVehicleController(body);
    wheels.forEach((w, i) => {
      // Hard point sits one rest length above the hub, so the hub lands near the
      // modelled height once the spring has taken the weight.
      this.ctl.addWheel({ x: w.x, y: w.y + tune.rest * 0.75, z: w.z }, UP, AXLE, tune.rest, w.r);
      this.ctl.setWheelSuspensionStiffness(i, tune.stiffness);
      this.ctl.setWheelSuspensionCompression(i, tune.compression);
      this.ctl.setWheelSuspensionRelaxation(i, tune.relaxation);
      this.ctl.setWheelMaxSuspensionTravel(i, tune.travel);
      this.ctl.setWheelMaxSuspensionForce(i, tune.maxForce);
      this.ctl.setWheelFrictionSlip(i, tune.frictionSlip);
      this.ctl.setWheelSideFrictionStiffness(i, tune.sideStiffness);
    });
    const byAxle = new Map<number, number[]>();
    wheels.forEach((w, i) => byAxle.set(w.axle, [...(byAxle.get(w.axle) ?? []), i]));
    for (const idx of byAxle.values()) {
      const left = idx.filter((i) => wheels[i].x < 0);
      const right = idx.filter((i) => wheels[i].x > 0);
      if (left.length && right.length) this.axles.push([left[0], right[0]]);
    }
  }

  /** Signed forward speed in m/s (forward is body -z). */
  speed() {
    const v = this.body.linvel();
    const q = this.body.rotation();
    // body -z in world space
    const fx = -(2 * (q.x * q.z + q.w * q.y));
    const fy = -(2 * (q.y * q.z - q.w * q.x));
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    return v.x * fx + v.y * fy + v.z * fz;
  }

  /** World up vector of the body. */
  up() {
    const q = this.body.rotation();
    return {
      x: 2 * (q.x * q.y - q.w * q.z),
      y: 1 - 2 * (q.x * q.x + q.z * q.z),
      z: 2 * (q.y * q.z + q.w * q.x),
    };
  }

  /** Call once per fixed step, before world.step(). */
  preStep(dt: number) {
    const b = this.body;
    // Forces persist in Rapier until reset; without this the anti-roll forces
    // accumulate step after step and flip the rig.
    b.resetForces(true);
    b.resetTorques(true);

    const up = this.up();
    for (const [l, r] of this.axles) {
      const cl = this.compression(l), cr = this.compression(r);
      const f = this.tune.antiRoll * (cl - cr);
      if (f === 0) continue;
      const pl = this.hardPointWorld(l), pr = this.hardPointWorld(r);
      b.addForceAtPoint({ x: up.x * f, y: up.y * f, z: up.z * f }, pl, true);
      b.addForceAtPoint({ x: -up.x * f, y: -up.y * f, z: -up.z * f }, pr, true);
    }
    this.ctl.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, GROUND_QUERY);
  }

  compression(i: number) {
    if (!this.ctl.wheelIsInContact(i)) return 0;
    return this.tune.rest - (this.ctl.wheelSuspensionLength(i) ?? this.tune.rest);
  }

  hardPointWorld(i: number) {
    const p = this.ctl.wheelChassisConnectionPointCs(i)!;
    return localToWorld(this.body, p);
  }

  setSteer(angle: number) {
    this.wheels.forEach((w, i) => w.steer && this.ctl.setWheelSteering(i, angle));
  }

  setDrive(force: number) {
    this.wheels.forEach((w, i) => w.drive && this.ctl.setWheelEngineForce(i, force));
  }

  setBrake(impulse: number, driveExtra = 0) {
    this.wheels.forEach((w, i) => this.ctl.setWheelBrake(i, impulse + (w.drive ? driveExtra : 0)));
  }

  inContact() {
    let n = 0;
    for (let i = 0; i < this.wheels.length; i++) if (this.ctl.wheelIsInContact(i)) n++;
    return n;
  }
}

export function localToWorld(body: RAPIER.RigidBody, p: { x: number; y: number; z: number }) {
  const t = body.translation(), q = body.rotation();
  // v' = v + w*u + q.xyz x u, with u = 2 * (q.xyz x v)
  const ux = 2 * (q.y * p.z - q.z * p.y);
  const uy = 2 * (q.z * p.x - q.x * p.z);
  const uz = 2 * (q.x * p.y - q.y * p.x);
  return {
    x: t.x + p.x + q.w * ux + (q.y * uz - q.z * uy),
    y: t.y + p.y + q.w * uy + (q.z * ux - q.x * uz),
    z: t.z + p.z + q.w * uz + (q.x * uy - q.y * ux),
  };
}

/** Height of the ground (not decks, not dynamic bodies) under a world point. */
export function groundHeight(world: RAPIER.World, x: number, z: number, fromY = 50) {
  const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, 200, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, GROUND_QUERY);
  return hit ? fromY - hit.timeOfImpact : 0;
}
