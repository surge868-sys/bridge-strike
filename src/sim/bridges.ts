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
  concreteMap: THREE.Texture,
): Overpass {
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
  const slabBottom = Math.max(cl, cr) + 1.15;
  const deckTop = slabBottom + SLAB;

  const concrete = (repeat: number) => {
    const map = concreteMap.clone();
    map.needsUpdate = true;
    map.repeat.set(repeat, repeat * 0.4);
    return new THREE.MeshStandardMaterial({ map, color: 0xd8d2c8, roughness: 0.92, metalness: 0 });
  };
  const deckMat = concrete(6);
  const pierMat = concrete(1.5);

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

  // Slab and parapets
  addBox(ABUT_X * 2, SLAB, DECK_HALF_Z * 2, 0, slabBottom + SLAB / 2, def.z, deckMat);
  for (const s of [-1, 1]) addBox(ABUT_X * 2, 1.05, 0.35, 0, deckTop + 0.52, def.z + s * (DECK_HALF_Z - 0.2), deckMat);

  // Girders per span: deeper over lower-clearance lanes. Five girder lines across the deck.
  for (const s of spans) {
    const w = s.max - s.min, cx = (s.min + s.max) / 2, depth = slabBottom - s.clearance;
    for (let k = 0; k < 5; k++) {
      const gz = def.z - DECK_HALF_Z + 0.6 + k * ((DECK_HALF_Z * 2 - 1.2) / 4);
      addBox(w, depth, 0.55, cx, s.clearance + depth / 2, gz, deckMat);
    }
    // Strike volume: the whole span from soffit to deck top.
    const col = world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, (deckTop - s.clearance) / 2, DECK_HALF_Z)
        .setTranslation(cx, (s.clearance + deckTop) / 2, def.z)
        .setCollisionGroups(groups(G.DECK, 0xffff)),
    );
    strikeColliders.add(col.handle);
    // Fascia on the approach face, closing the girder ends.
    addBox(w, depth + SLAB, 0.25, cx, s.clearance + (depth + SLAB) / 2, def.z + DECK_HALF_Z + 0.05, deckMat);
  }

  // Piers: median and outer shoulders only. Three columns each, with a cap beam.
  const hazard = hazardTexture();
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6 });
  for (const px of [-PIER_X, 0, PIER_X]) {
    const soffit = Math.min(...spans.filter((s) => s.min <= px + 1 && s.max >= px - 1).map((s) => s.clearance));
    const ground = Math.min(0, terrainHeight(px, def.z));
    const colH = soffit - 0.7 - ground;
    for (const dz of [-3.6, 0, 3.6]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, colH, 16), pierMat);
      col.position.set(px, ground + colH / 2, def.z + dz);
      col.castShadow = col.receiveShadow = true;
      group.add(col);
    }
    addBox(1.3, 0.7, DECK_HALF_Z * 2 - 0.6, px, soffit - 0.35, def.z, pierMat);
    const pc = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.55, (soffit - ground) / 2, DECK_HALF_Z - 0.6)
        .setTranslation(px, (soffit + ground) / 2, def.z)
        .setCollisionGroups(groups(G.PIER, 0xffff)),
    );
    strikeColliders.add(pc.handle);
    // Hazard board on the traffic face of the front column
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 1.8), hazardMat);
    board.position.set(px, ground + 1.6, def.z + 3.6 + 0.52);
    group.add(board);
  }

  // Abutment walls and grassed embankments carrying the crossing road.
  const fillMat = new THREE.MeshStandardMaterial({ color: 0x8a8150, roughness: 1 });
  for (const s of [-1, 1]) {
    addBox(1.2, deckTop + 1.5, DECK_HALF_Z * 2 + 2, s * (ABUT_X + 0.6), deckTop / 2 - 0.75, def.z, pierMat);
    const len = 70;
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(len, 1, DECK_HALF_Z * 2 + 8), fillMat);
    const slope = Math.atan2(deckTop + 1, len);
    ramp.geometry.translate(len / 2, -0.5, 0);
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
    plate.position.set((s.min + s.max) / 2, s.clearance + (slabBottom - s.clearance) * 0.5, def.z + DECK_HALF_Z + 0.2);
    group.add(plate);
  }

  const clearanceAt = (x: number) => {
    const s = spans.find((sp) => x >= sp.min && x <= sp.max);
    return s ? s.clearance : Infinity;
  };
  return { def, spans, group, strikeColliders, clearanceAt };
}
