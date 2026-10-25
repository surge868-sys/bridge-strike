// Overpasses. Each lane span has its own soffit height so the posted plate,
// the visual girders and the strike collider all use the same number.
import * as THREE from 'three';
import { RAPIER, G, groups } from './physics';
import { NB, terrainHeight } from './world';

export interface OverpassDef {
  id: string;
  name: string;
  z: number; // centre line of the crossing road
  kind: 'concrete' | 'rail';
  clearance: [number, number]; // northbound [left, right] lane, metres
}

export interface LaneSpan {
  min: number;
  max: number;
  clearance: number;
  lane?: 'LEFT' | 'RIGHT';
}

export interface Overpass {
  def: OverpassDef;
  spans: LaneSpan[];
  group: THREE.Group;
  strikeColliders: Set<number>;
  /** Where the girders' approach face sits (soffit height) over the northbound lanes. */
  faceZ: number;
  halfZ: number; // half the structure's depth along the highway
  /** Soffit height above the road at a given x (northbound side). */
  clearanceAt(x: number): number;
}

const DECK_HALF_Z = 6; // the crossing road is 12 m wide
const SLAB = 0.32;
const PIER_X = NB.gravelEdge + 1.6; // outer piers just past the gravel shoulder
const ABUT_X = 34;

function plateTexture(clearance: number) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c200';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#111';
  g.lineWidth = 14;
  g.strokeRect(10, 10, 492, 236);
  g.fillStyle = '#111';
  g.textAlign = 'center';
  g.font = '500 44px Oswald, sans-serif';
  g.fillText('CLEARANCE', 256, 74);
  g.font = '140px Anton, Impact, sans-serif';
  g.fillText(`${clearance.toFixed(2)} m`, 256, 218);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c200';
  g.fillRect(0, 0, 128, 512);
  g.fillStyle = '#111';
  for (let k = -4; k < 12; k++) {
    g.beginPath();
    g.moveTo(0, k * 64);
    g.lineTo(128, k * 64 + 128);
    g.lineTo(128, k * 64 + 160);
    g.lineTo(0, k * 64 + 32);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildOverpass(
  scene: THREE.Scene,
  world: RAPIER.World,
  def: OverpassDef,
  maps: { concrete: THREE.Texture; steel: THREE.Texture; grass?: THREE.Texture },
): Overpass {
  const rail = def.kind === 'rail';
  // A road overpass carries a 12 m deck; a rail bridge is a narrow steel through-girder span.
  const HALF_Z = rail ? 3.0 : DECK_HALF_Z;
  const group = new THREE.Group();
  group.name = def.id;
  scene.add(group);
  const [cl, cr] = def.clearance;

  // Northbound spans, inside to out; the southbound side mirrors them.
  const nb: LaneSpan[] = [
    { min: 0.8, max: NB.innerEdge, clearance: cl },
    { min: NB.innerEdge, max: NB.laneLine, clearance: cl, lane: 'LEFT' },
    { min: NB.laneLine, max: NB.outerEdge, clearance: cr, lane: 'RIGHT' },
    { min: NB.outerEdge, max: ABUT_X, clearance: cr },
  ];
  const spans = [...nb, ...nb.map((s) => ({ ...s, min: -s.max, max: -s.min, lane: undefined }))];
  const cmax = Math.max(cl, cr);
  const slabBottom = cmax + 1.15;
  const deckTop = rail ? cmax + 2.6 : slabBottom + SLAB;

  const concrete = (repeat: number) => {
    const map = maps.concrete.clone();
    map.needsUpdate = true;
    map.repeat.set(repeat, repeat * 0.4);
    return new THREE.MeshStandardMaterial({ map, color: 0xd8d2c8, roughness: 0.92, metalness: 0 });
  };
  const deckMat = concrete(6);
  const pierMat = concrete(1.5);
  const steelMap = maps.steel.clone();
  steelMap.needsUpdate = true;
  steelMap.repeat.set(10, 1);
  const steelMat = new THREE.MeshStandardMaterial({ map: steelMap, roughness: 0.7, metalness: 0.55 });

  const strikeColliders = new Set<number>();
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, colliderGroup?: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    if (colliderGroup) {
      const col = world.createCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
          .setTranslation(x, y, z)
          .setCollisionGroups(groups(colliderGroup, 0xffff)),
      );
      strikeColliders.add(col.handle);
    }
    return mesh;
  };

  if (!rail) {
    // Slab and parapets
    addBox(ABUT_X * 2, SLAB, HALF_Z * 2, 0, slabBottom + SLAB / 2, def.z, deckMat);
    for (const s of [-1, 1]) addBox(ABUT_X * 2, 1.05, 0.35, 0, deckTop + 0.52, def.z + s * (HALF_Z - 0.2), deckMat);
  } else {
    // Ballast and track run level across the top of the floor.
    const ballastMat = new THREE.MeshStandardMaterial({ color: 0x6d655c, roughness: 1 });
    addBox(ABUT_X * 2, 0.4, HALF_Z * 2 - 1.2, 0, cmax + 0.55, def.z, ballastMat);
    for (const rz of [-0.72, 0.72]) addBox(ABUT_X * 2, 0.16, 0.08, 0, cmax + 0.83, def.z + rz, steelMat);
  }

  for (const s of spans) {
    const w = s.max - s.min, cx = (s.min + s.max) / 2;
    if (!rail) {
      // Girders per span: deeper over lower-clearance lanes. Five girder lines across the deck.
      const depth = slabBottom - s.clearance;
      for (let k = 0; k < 5; k++) {
        const gz = def.z - HALF_Z + 0.6 + k * ((HALF_Z * 2 - 1.2) / 4);
        addBox(w, depth, 0.55, cx, s.clearance + depth / 2, gz, deckMat);
      }
      // Fascia on the approach face, closing the girder ends.
      addBox(w, depth + SLAB, 0.25, cx, s.clearance + (depth + SLAB) / 2, def.z + HALF_Z + 0.05, deckMat);
    } else {
      // Two riveted plate girders with a steel floor slung between their bottom flanges.
      const h = deckTop - s.clearance;
      for (const gz of [-1, 1]) addBox(w, h, 0.36, cx, s.clearance + h / 2, def.z + gz * (HALF_Z - 0.18), steelMat);
      addBox(w, 0.35, HALF_Z * 2 - 0.4, cx, s.clearance + 0.175, def.z, steelMat);
    }
    // Strike volume: the whole span from soffit to the top of the structure.
    const col = world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, (deckTop - s.clearance) / 2, HALF_Z)
        .setTranslation(cx, (s.clearance + deckTop) / 2, def.z)
        .setCollisionGroups(groups(G.DECK, 0xffff)),
    );
    strikeColliders.add(col.handle);
  }

  // Piers: median and outer shoulders only. Three columns each, with a cap beam.
  const hazard = hazardTexture();
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6 });
  for (const px of [-PIER_X, 0, PIER_X]) {
    const soffit = Math.min(...spans.filter((s) => s.min <= px + 1 && s.max >= px - 1).map((s) => s.clearance));
    const ground = Math.min(0, terrainHeight(px, def.z));
    const colH = soffit - 0.7 - ground;
    const cols = rail ? [-1.6, 1.6] : [-3.6, 0, 3.6];
    for (const dz of cols) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, colH, 16), pierMat);
      col.position.set(px, ground + colH / 2, def.z + dz);
      col.castShadow = col.receiveShadow = true;
      group.add(col);
    }
    addBox(1.3, 0.7, HALF_Z * 2 - 0.6, px, soffit - 0.35, def.z, pierMat);
    const pc = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.55, (soffit - ground) / 2, HALF_Z - 0.6)
        .setTranslation(px, (soffit + ground) / 2, def.z)
        .setCollisionGroups(groups(G.PIER, 0xffff)),
    );
    strikeColliders.add(pc.handle);
    // Hazard board on the traffic face of the front column
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 1.8), hazardMat);
    board.position.set(px, ground + 1.6, def.z + cols[cols.length - 1] + 0.52);
    group.add(board);
  }

  // Abutment walls and grassed embankments carrying the crossing road.
  let fillMap: THREE.Texture | null = null;
  if (maps.grass) {
    fillMap = maps.grass.clone();
    fillMap.repeat.set(10, 2);
    fillMap.needsUpdate = true;
  }
  const fillMat = new THREE.MeshStandardMaterial({ color: fillMap ? 0xd8dcc8 : 0x8a8150, roughness: 1, map: fillMap });
  for (const s of [-1, 1]) {
    addBox(1.2, deckTop + 1.5, HALF_Z * 2 + 2, s * (ABUT_X + 0.6), deckTop / 2 - 0.75, def.z, pierMat);
    const len = 70;
    // Deep enough that the sloped box reads as a solid berm down to the ground.
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(len, 9, HALF_Z * 2 + 8), fillMat);
    const slope = Math.atan2(deckTop + 1, len);
    ramp.geometry.translate(len / 2, -4.5, 0);
    ramp.position.set(s * (ABUT_X + 1.2), deckTop, def.z);
    ramp.rotation.z = -slope; // far end down; Euler XYZ applies this before the y flip
    if (s < 0) ramp.rotation.y = Math.PI;
    ramp.receiveShadow = true;
    group.add(ramp);
  }

  // Posted plate centred over each northbound lane, on the approach fascia.
  for (const s of nb.filter((n) => n.lane)) {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.8),
      new THREE.MeshStandardMaterial({ map: plateTexture(s.clearance), roughness: 0.5, emissive: 0x222222 }),
    );
    const y = rail ? s.clearance + 1.0 : s.clearance + (slabBottom - s.clearance) * 0.5;
    plate.position.set((s.min + s.max) / 2, y, def.z + HALF_Z + 0.2);
    group.add(plate);
  }

  const clearanceAt = (x: number) => {
    const s = spans.find((sp) => x >= sp.min && x <= sp.max);
    return s ? s.clearance : Infinity;
  };
  return { def, spans, group, strikeColliders, faceZ: def.z + HALF_Z, halfZ: HALF_Z, clearanceAt };
}

/** Remove an overpass's meshes and colliders (the route is rebuilt per load). */
export function destroyOverpass(scene: THREE.Scene, world: RAPIER.World, op: Overpass) {
  for (const h of op.strikeColliders) {
    const c = world.getCollider(h);
    if (c) world.removeCollider(c, false);
  }
  scene.remove(op.group);
  op.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.dispose();
  });
}

// The drive: Highway 11 north into the city through six overpasses, in the order
// they are met (the truck drives toward -z). A composite route with real names.
export const START_Z = 870; // ~160 m before the first overpass: about 10 s at the rolling-start speed
export const DELIVERY_Z = -720; // city limits: the load is delivered once the trailer is past
export const ROUTE: Omit<OverpassDef, 'clearance'>[] = [
  { id: 'hwy16-circle', name: 'HWY 16 · CIRCLE DR', z: 700, kind: 'concrete' },
  { id: '108th', name: '108TH STREET', z: 470, kind: 'concrete' },
  { id: 'cpkc', name: 'CPKC RAIL BRIDGE', z: 240, kind: 'rail' },
  { id: 'mckercher', name: 'MCKERCHER DRIVE', z: 10, kind: 'concrete' },
  { id: '51st', name: '51ST STREET', z: -220, kind: 'concrete' },
  { id: 'cn-idylwyld', name: 'CN RAIL · IDYLWYLD', z: -450, kind: 'rail' },
];

// Clearances are posted around each load's height, so every bridge is a decision:
// F fits as is, L fits only lowered (the deck drops 0.30 m), N cannot be cleared.
// [left, right] per overpass; the run starts in the right lane. Harder load by load.
type Code = 'F' | 'L' | 'N';
const PATTERNS: [Code, Code][][] = [
  [['F', 'L'], ['F', 'F'], ['L', 'F'], ['F', 'L'], ['F', 'F'], ['N', 'F']],
  [['F', 'L'], ['N', 'F'], ['L', 'F'], ['F', 'N'], ['L', 'L'], ['F', 'L']],
  [['L', 'N'], ['F', 'L'], ['N', 'L'], ['L', 'F'], ['L', 'L'], ['N', 'F']],
  [['N', 'L'], ['L', 'L'], ['F', 'N'], ['N', 'L'], ['L', 'N'], ['L', 'L']],
  [['L', 'N'], ['N', 'L'], ['L', 'L'], ['N', 'L'], ['L', 'N'], ['N', 'L']],
];
// Offsets from the load's top, in metres. L leaves 0.10-0.25 m once lowered; N is
// at least 0.05 m too low even lowered.
const OFFSETS: Record<Code, number[]> = { F: [0.1, 0.15, 0.25, 0.35], L: [-0.05, -0.1, -0.15, -0.2], N: [-0.35, -0.4, -0.5] };

export function routeFor(loadIndex: number, loadTop: number): OverpassDef[] {
  const pattern = PATTERNS[Math.min(loadIndex, PATTERNS.length - 1)];
  return ROUTE.map((r, i) => {
    const pick = (code: Code, lane: number) => {
      const opts = OFFSETS[code];
      const h = Math.abs(Math.sin((loadIndex + 1) * 12.9898 + (i + 1) * 78.233 + lane * 37.719) * 43758.5453) % 1;
      return Math.round((loadTop + opts[Math.floor(h * opts.length)]) * 100) / 100;
    };
    return { ...r, clearance: [pick(pattern[i][0], 0), pick(pattern[i][1], 1)] as [number, number] };
  });
}
