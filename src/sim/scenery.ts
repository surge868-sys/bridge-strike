// Prairie set dressing: shelterbelt rows, single trees, farmyards with grain bins,
// and the Saskatoon skyline on the northern horizon. Everything is placed from a
// fixed seed, so every run sees the same countryside.
import * as THREE from 'three';
import { terrainHeight, VIEW_HALF } from './world';
import type { LightPreset } from './timeofday';

export interface SceneryTextures {
  tree: THREE.Texture;
  shelterbelt: THREE.Texture;
  farmyard: THREE.Texture;
  skyline: THREE.Texture;
}

export interface Scenery {
  update(camera: THREE.Camera): void;
  apply(p: LightPreset): void;
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLEAR_X = 46; // keep the highway corridor, poles and overpass ramps clear
const FIELD = 400; // matches the terrain shader's field grid

/** Alpha-tested foliage that lights like the ground: normals point up and never flip on back faces. */
function foliageMaterial(map: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
    );
  };
  return mat;
}

function depthMaterial(map: THREE.Texture) {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
}

/** Plane with its bottom edge at y = 0 and normals pointing up. */
function card(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function crossCard(w: number, h: number) {
  const a = card(w, h);
  const b = card(w, h).rotateY(Math.PI / 2);
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const A = a.attributes[name].array as Float32Array, B = b.attributes[name].array as Float32Array;
    const out = new Float32Array(A.length + B.length);
    out.set(A);
    out.set(B, A.length);
    merged.setAttribute(name, new THREE.BufferAttribute(out, a.attributes[name].itemSize));
  }
  const ia = Array.from(a.index!.array), ib = Array.from(b.index!.array).map((i) => i + a.attributes.position.count);
  merged.setIndex([...ia, ...ib]);
  return merged;
}

export function buildScenery(scene: THREE.Scene, tex: SceneryTextures, overpassZ: number[]): Scenery {
  const rand = rng(1905); // the year Saskatchewan joined Confederation
  const group = new THREE.Group();
  scene.add(group);
  for (const t of Object.values(tex)) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; }

  // Crossing roads run east-west on embankments out to about x = 105.
  const blocked = (x: number, z: number) => Math.abs(x) < CLEAR_X || (Math.abs(x) < 150 && overpassZ.some((oz) => Math.abs(z - oz) < 32));

  type Seg = { x: number; z: number; rotY: number; w: number; h: number; flip: boolean };
  const rows: Seg[] = [];
  const trees: { x: number; z: number; s: number; r: number }[] = [];
  const yards: { x: number; z: number }[] = [];

  /** A shelterbelt row from (x0,z0) to (x1,z1), as overlapping 30 m cards. */
  const addRow = (x0: number, z0: number, x1: number, z1: number, height = 1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 26));
    const rotY = Math.atan2(-(z1 - z0), x1 - x0);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const w = 30 * (0.9 + rand() * 0.25);
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (blocked(x, z)) continue;
      rows.push({ x, z, rotY, w, h: w * (405 / 1024) * height * (0.85 + rand() * 0.3), flip: rand() < 0.5 });
      if (rand() < 0.35 && !blocked(x, z)) trees.push({ x: x + (rand() - 0.5) * 20, z: z + (rand() - 0.5) * 20, s: 0.9 + rand() * 0.5, r: rand() * Math.PI });
    }
  };

  // Field-edge shelterbelts on a quarter of the field boundaries.
  const span = Math.floor((VIEW_HALF - 200) / FIELD);
  for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) {
    const x = i * FIELD, z = j * FIELD;
    if (rand() < 0.22 && Math.abs(x) > CLEAR_X) {
      const a = rand() * 0.3, b = 0.7 + rand() * 0.3;
      addRow(x, z + FIELD * a, x, z + FIELD * b); // north-south row on a field line
    }
    if (rand() < 0.2) {
      const a = rand() * 0.3, b = 0.7 + rand() * 0.3;
      let xa = x + FIELD * a, xb = x + FIELD * b;
      if (xa < CLEAR_X && xb > -CLEAR_X) { if (xa > -CLEAR_X) xa = CLEAR_X; else xb = -CLEAR_X; }
      addRow(xa, z, xb, z); // east-west row
    }
  }

  // Roadside belts along the highway right-of-way, so there is foliage close enough
  // to read speed against.
  for (const side of [-1, 1]) {
    let z = -VIEW_HALF + 200;
    while (z < VIEW_HALF - 200) {
      const len = 80 + rand() * 260;
      if (rand() < 0.45) {
        const x = side * (62 + rand() * 50);
        addRow(x, z, x, z + len, 0.9 + rand() * 0.3);
      }
      z += len + 40 + rand() * 160;
    }
  }

  // Farmyards: shelterbelts on the north and west, open to the south-east.
  for (let k = 0; k < 18; k++) {
    let x = 0, z = 0;
    for (let tries = 0; tries < 20; tries++) {
      const side = rand() < 0.5 ? -1 : 1;
      x = side * (110 + Math.pow(rand(), 1.4) * (VIEW_HALF - 600));
      z = -VIEW_HALF + 500 + rand() * (VIEW_HALF * 2 - 900);
      if (yards.every((y) => Math.hypot(y.x - x, y.z - z) > 360) && !overpassZ.some((oz) => Math.abs(z - oz) < 110)) break;
    }
    yards.push({ x, z });
    addRow(x - 70, z - 60, x + 75, z - 60, 1.1);
    addRow(x - 75, z - 55, x - 75, z + 70, 1.1);
    if (rand() < 0.5) addRow(x - 60, z - 72, x + 60, z - 72, 0.9); // double row
    for (let t = 0; t < 6; t++) {
      const tx = x - 40 + rand() * 90, tz = z - 40 + rand() * 60;
      if (!blocked(tx, tz)) trees.push({ x: tx, z: tz, s: 0.9 + rand() * 0.6, r: rand() * Math.PI });
    }
  }

  // A few lone trees along the ditches and fence lines nearer the road.
  for (let k = 0; k < 90; k++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (CLEAR_X + 4 + rand() * 260), z = -VIEW_HALF + 300 + rand() * (VIEW_HALF * 2 - 600);
    if (!blocked(x, z)) trees.push({ x, z, s: 0.8 + rand() * 0.6, r: rand() * Math.PI });
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  // --- shelterbelt rows: one instanced card, scaled per segment
  const rowMesh = new THREE.InstancedMesh(card(1, 1), foliageMaterial(tex.shelterbelt), rows.length);
  rowMesh.customDepthMaterial = depthMaterial(tex.shelterbelt);
  rows.forEach((r, i) => {
    q.setFromAxisAngle(up, r.rotY);
    m4.compose(new THREE.Vector3(r.x, terrainHeight(r.x, r.z) - 0.4, r.z), q, new THREE.Vector3(r.flip ? -r.w : r.w, r.h, 1));
    rowMesh.setMatrixAt(i, m4);
  });
  rowMesh.castShadow = true;
  rowMesh.receiveShadow = true;
  rowMesh.frustumCulled = false;
  group.add(rowMesh);

  // --- single trees: crossed cards
  const treeMesh = new THREE.InstancedMesh(crossCard(1, 467 / 384), foliageMaterial(tex.tree), trees.length);
  treeMesh.customDepthMaterial = depthMaterial(tex.tree);
  trees.forEach((t, i) => {
    q.setFromAxisAngle(up, t.r);
    const s = 9 * t.s;
    m4.compose(new THREE.Vector3(t.x, terrainHeight(t.x, t.z) - 0.3, t.z), q, new THREE.Vector3(s, s, s));
    treeMesh.setMatrixAt(i, m4);
  });
  treeMesh.castShadow = true;
  treeMesh.frustumCulled = false;
  group.add(treeMesh);

  // --- farmyard billboards turn to face the camera about their vertical axis
  const yardW = 92, yardH = yardW * (217 / 1024);
  const yardMat = foliageMaterial(tex.farmyard);
  const yardDepth = depthMaterial(tex.farmyard);
  const yardGeo = card(yardW, yardH);
  const yardMeshes = yards.map((y) => {
    const m = new THREE.Mesh(yardGeo, yardMat);
    m.customDepthMaterial = yardDepth;
    m.position.set(y.x + 10, terrainHeight(y.x + 10, y.z + 20) - 1.2, y.z + 20);
    m.castShadow = true;
    group.add(m);
    return m;
  });

  // --- grain bins: corrugated cylinders with cone roofs, in rows beside the yards
  const binGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
  const roofGeo = new THREE.ConeGeometry(1.04, 0.42, 20, 1, true).translate(0, 0.21, 0);
  const binMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.75, roughness: 0.38 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xb3b8bd, metalness: 0.7, roughness: 0.45 });
  const bins: { x: number; z: number; r: number; h: number }[] = [];
  yards.forEach((y) => {
    const n = 3 + Math.floor(rand() * 6);
    const r = 3.6 + rand() * 1.6, h = 6 + rand() * 4;
    // bins line up on the side of the yard away from the highway
    const dir = Math.sign(y.x);
    const bx = y.x + dir * (55 + rand() * 20), bz = y.z - 20 + rand() * 30;
    for (let k = 0; k < n; k++) bins.push({ x: bx + dir * k * (r * 2 + 1.5), z: bz + (rand() - 0.5) * 2, r, h });
  });
  // lone bin sites out on the horizon
  for (let k = 0; k < 16; k++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (300 + rand() * (VIEW_HALF - 800)), z = -VIEW_HALF + 400 + rand() * (VIEW_HALF * 2 - 800);
    const n = 2 + Math.floor(rand() * 4), r = 3.5 + rand() * 2, h = 5.5 + rand() * 4;
    for (let i = 0; i < n; i++) bins.push({ x: x + side * i * (r * 2 + 1.2), z, r, h });
  }
  const binMesh = new THREE.InstancedMesh(binGeo, binMat, bins.length);
  const roofMesh = new THREE.InstancedMesh(roofGeo, roofMat, bins.length);
  bins.forEach((b, i) => {
    const y = terrainHeight(b.x, b.z) - 0.2;
    m4.compose(new THREE.Vector3(b.x, y, b.z), q.identity(), new THREE.Vector3(b.r, b.h, b.r));
    binMesh.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(b.x, y + b.h, b.z), q.identity(), new THREE.Vector3(b.r, b.r * 1.7, b.r));
    roofMesh.setMatrixAt(i, m4);
  });
  binMesh.castShadow = roofMesh.castShadow = true;
  binMesh.frustumCulled = roofMesh.frustumCulled = false;
  group.add(binMesh, roofMesh);

  // --- Saskatoon skyline: a painted strip past the fog, tinted toward the haze
  const skyMat = new THREE.MeshBasicMaterial({ map: tex.skyline, transparent: true, depthWrite: false, fog: false });
  const haze = { color: { value: new THREE.Color() }, amount: { value: 0.4 } };
  skyMat.onBeforeCompile = (shader) => {
    shader.uniforms.hazeColor = haze.color;
    shader.uniforms.hazeAmount = haze.amount;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 hazeColor; uniform float hazeAmount;')
      .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, hazeColor, hazeAmount);\n#include <opaque_fragment>');
  };
  const skyH = 260, skyW = skyH * (2048 / 499);
  const skyline = new THREE.Mesh(new THREE.PlaneGeometry(skyW, skyH).translate(0, skyH / 2, 0), skyMat);
  skyline.position.set(-80, -14, -VIEW_HALF + 400);
  skyline.renderOrder = 2;
  group.add(skyline);

  const look = new THREE.Vector3();
  return {
    update(camera) {
      for (const m of yardMeshes) {
        look.set(camera.position.x, m.position.y, camera.position.z);
        m.rotation.y = Math.atan2(look.x - m.position.x, look.z - m.position.z);
      }
    },
    apply(p) {
      haze.color.value.set(p.fog);
      haze.amount.value = p.skylineHaze;
    },
  };
}
