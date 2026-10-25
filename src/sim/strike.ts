// Strike effects: concrete chunks (or rust flakes and sparks off a rail bridge) and
// a dust burst. Everything is a pure function of time since the impact, so the
// replay can scrub it back and forth.
import * as THREE from 'three';

const CHUNKS = 110;
const SPARKS = 50;
const PUFFS = 22;
const G = 9.81;

interface Particle { p: THREE.Vector3; v: THREE.Vector3; w: THREE.Vector3; s: number; tLand: number; ground: number }

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class StrikeFx {
  private chunks: THREE.InstancedMesh;
  private sparks: THREE.InstancedMesh;
  private puffs: THREE.Sprite[] = [];
  private chunkP: Particle[] = [];
  private sparkP: Particle[] = [];
  private puffP: { p: THREE.Vector3; v: THREE.Vector3; s: number; delay: number }[] = [];
  private chunkMat: THREE.MeshStandardMaterial;
  private active = false;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    this.chunkMat = new THREE.MeshStandardMaterial({ color: 0xbdb6aa, roughness: 0.95 });
    this.chunks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), this.chunkMat, CHUNKS);
    this.chunks.castShadow = true;
    this.chunks.frustumCulled = false;
    this.sparks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.03, 0.03, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xffa040, emissiveIntensity: 8 }),
      SPARKS,
    );
    this.sparks.frustumCulled = false;
    const tex = puffTexture();
    for (let i = 0; i < PUFFS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xb9a78f, transparent: true, depthWrite: false, opacity: 0 }));
      this.puffs.push(s);
    }
    this.chunks.visible = this.sparks.visible = false;
    scene.add(this.chunks, this.sparks, ...this.puffs);
    for (const s of this.puffs) s.visible = false;
  }

  /** `at` is the impact point, `speed` the rig's speed in m/s, `heading` its world forward. */
  start(at: THREE.Vector3, speed: number, heading: THREE.Vector3, kind: 'concrete' | 'rail', seed = 7) {
    const r = rng(seed);
    const k = Math.min(1.6, 0.5 + speed / 20);
    const side = new THREE.Vector3(-heading.z, 0, heading.x);
    this.chunkMat.color.set(kind === 'rail' ? 0x5a4334 : 0xbdb6aa);
    const spray = (n: number, list: Particle[], size: () => number, power: number, up: number) => {
      list.length = 0;
      for (let i = 0; i < n; i++) {
        // Debris mostly carries on the way the rig was going and rains down.
        const v = heading.clone().multiplyScalar((0.2 + r() * 0.6) * speed * power)
          .addScaledVector(side, (r() - 0.5) * 9 * k)
          .add(new THREE.Vector3(0, (r() - 0.3) * up * k, 0));
        const p = at.clone().addScaledVector(side, (r() - 0.5) * 2.4).add(new THREE.Vector3(0, r() * 0.4, (r() - 0.5) * 0.6));
        // Landing time on the road (y = s): solve p.y + v.y t - g t^2 / 2 = s.
        const s = size();
        const a = 0.5 * G, b = -v.y, c = s - p.y;
        const tLand = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
        list.push({ p, v, w: new THREE.Vector3(r() * 14 - 7, r() * 14 - 7, r() * 14 - 7), s, tLand, ground: s });
      }
    };
    spray(CHUNKS, this.chunkP, () => 0.1 + Math.pow(r(), 2.0) * 0.55, 0.55, 7);
    spray(kind === 'rail' ? SPARKS : 0, this.sparkP, () => 1, 0.9, 7);
    this.puffP = [];
    for (let i = 0; i < PUFFS; i++) {
      this.puffP.push({
        p: at.clone().addScaledVector(side, (r() - 0.5) * 3).add(new THREE.Vector3(0, (r() - 0.6) * 1.2, 0)),
        v: heading.clone().multiplyScalar(speed * 0.12 * r()).addScaledVector(side, (r() - 0.5) * 2.5).add(new THREE.Vector3(0, -0.4 + r() * 0.8, 0)),
        s: 2.2 + r() * 2.4,
        delay: r() * 0.15,
      });
    }
    this.active = true;
    this.chunks.visible = true;
    this.sparks.visible = this.sparkP.length > 0;
    this.chunks.count = CHUNKS;
    this.sparks.count = this.sparkP.length;
    for (const s of this.puffs) s.visible = true;
  }

  /** Pose everything for `t` seconds after the impact (negative hides it). */
  update(t: number) {
    if (!this.active) return;
    const show = t >= 0;
    this.chunks.visible = show;
    this.sparks.visible = show && this.sparkP.length > 0;
    for (const s of this.puffs) s.visible = show;
    if (!show) return;
    const place = (list: Particle[], mesh: THREE.InstancedMesh, life: number, stretch: boolean) => {
      list.forEach((pt, i) => {
        const tl = Math.min(t, pt.tLand);
        const after = Math.max(0, t - pt.tLand);
        // flight, then a short skid along the road
        this.v.copy(pt.p).addScaledVector(pt.v, tl);
        this.v.y -= 0.5 * G * tl * tl;
        if (after > 0) {
          const skid = Math.min(after, 0.4) * (1 - Math.min(after, 0.4) / 0.8);
          this.v.x += pt.v.x * 0.25 * skid;
          this.v.z += pt.v.z * 0.25 * skid;
          this.v.y = pt.ground;
        }
        const spin = Math.min(t, pt.tLand + 0.3);
        if (stretch) {
          // sparks point along their velocity and burn out
          const dir = new THREE.Vector3(pt.v.x, pt.v.y - G * tl, pt.v.z).normalize();
          this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
          const s = t < life ? 1 - t / life : 0;
          this.sc.set(s, s, s * (after > 0 ? 0.2 : 1));
        } else {
          this.q.setFromEuler(this.e.set(pt.w.x * spin, pt.w.y * spin, pt.w.z * spin));
          this.sc.setScalar(pt.s);
        }
        this.m4.compose(this.v, this.q, this.sc);
        mesh.setMatrixAt(i, this.m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(this.chunkP, this.chunks, 99, false);
    place(this.sparkP, this.sparks, 0.9, true);
    this.puffP.forEach((pf, i) => {
      const s = this.puffs[i];
      const tt = Math.max(0, t - pf.delay);
      s.position.copy(pf.p).addScaledVector(pf.v, tt);
      const grow = pf.s * (1 + tt * 1.6);
      s.scale.set(grow, grow, 1);
      (s.material as THREE.SpriteMaterial).opacity = tt <= 0 ? 0 : Math.min(1, tt * 8) * Math.max(0, 1 - tt / 4) * 0.85;
    });
  }

  clear() {
    this.active = false;
    this.chunks.visible = this.sparks.visible = false;
    for (const s of this.puffs) s.visible = false;
  }
}
