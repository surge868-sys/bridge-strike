// Import pipeline for generated GLBs.
//
//   node scripts/assets/import-glb.mjs [assetName ...]
//
// Reads assets/models/manifest.json. For each asset it:
//   1. bakes every node transform into the vertices and applies the manifest
//      yaw so the model faces -z, plus an optional per-axis proportion fix,
//   2. scales uniformly so the chosen axis matches the real dimension in metres,
//   3. puts the origin on the ground (min y = 0) and centres x/z,
//   4. deletes triangles inside each wheel cylinder and adds an empty pivot
//      node per wheel, centred on its hub (the game instances wheel meshes),
//   5. splits named parts (cab shell, hood ...) out by box so the game can
//      show or hide them,
//   6. decimates to the triangle budget, re-encodes textures as webp and
//      meshopt-compresses,
//   7. writes public/models/<name>.glb and a bounds report.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, flatten, join, weld, prune, simplify, textureCompress, meshopt, transformMesh,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const manifestPath = path.join(root, 'assets/models/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const only = process.argv.slice(2);

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const AXES = { x: 0, y: 1, z: 2 };

function mat4(yawDeg, scale, tx = 0, ty = 0, tz = 0) {
  const a = (yawDeg * Math.PI) / 180, c = Math.cos(a) * scale, s = Math.sin(a) * scale;
  // column-major: rotation about +y, then uniform scale, then translation
  return [c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, tx, ty, tz, 1];
}

function primitives(doc) {
  const out = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) out.push({ mesh, prim });
  return out;
}

function bounds(doc) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { prim } of primitives(doc)) {
    const pos = prim.getAttribute('POSITION');
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      for (let k = 0; k < 3; k++) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; }
    }
  }
  return { min, max, size: max.map((m, k) => m - min[k]) };
}

function triangleCount(doc) {
  let n = 0;
  for (const { prim } of primitives(doc)) {
    const idx = prim.getIndices();
    n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  }
  return Math.round(n);
}

function inWheel(p, w) {
  // Wheel axle runs along x. w = { x, y, z, r, width }
  const dy = p[1] - w.y, dz = p[2] - w.z;
  return Math.abs(p[0] - w.x) <= w.width / 2 && dy * dy + dz * dz <= w.r * w.r;
}

function inBox(p, b) {
  return p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2];
}

// Re-partition triangles by centroid: dropped (inside a wheel or a cut box),
// moved into a named part, or kept in the body.
function partition(doc, { wheels = [], cuts = [], parts = {} }) {
  const scene = doc.getRoot().listScenes()[0];
  const partEntries = Object.entries(parts);
  const stats = { removed: 0, parts: {} };
  for (const { mesh, prim } of primitives(doc)) {
    const pos = prim.getAttribute('POSITION');
    const idxAcc = prim.getIndices();
    const count = idxAcc ? idxAcc.getCount() : pos.getCount();
    const idx = (i) => (idxAcc ? idxAcc.getScalar(i) : i);
    const keep = [], buckets = Object.fromEntries(partEntries.map(([n]) => [n, []]));
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (let t = 0; t < count; t += 3) {
      const i0 = idx(t), i1 = idx(t + 1), i2 = idx(t + 2);
      pos.getElement(i0, a); pos.getElement(i1, b); pos.getElement(i2, c);
      const p = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      if (wheels.some((w) => inWheel(p, w)) || cuts.some((box) => inBox(p, box))) { stats.removed++; continue; }
      const part = partEntries.find(([, box]) => inBox(p, box));
      (part ? buckets[part[0]] : keep).push(i0, i1, i2);
    }
    const makeIdx = (arr) => doc.createAccessor().setType('SCALAR').setArray(
      pos.getCount() > 65535 ? new Uint32Array(arr) : new Uint16Array(arr));
    prim.setIndices(makeIdx(keep));
    for (const [name, arr] of Object.entries(buckets)) {
      if (!arr.length) continue;
      const p2 = prim.clone().setIndices(makeIdx(arr));
      const m2 = doc.createMesh(name).addPrimitive(p2);
      scene.addChild(doc.createNode(name).setMesh(m2));
      stats.parts[name] = (stats.parts[name] ?? 0) + arr.length / 3;
    }
    mesh.setName(mesh.getName() || 'body');
  }
  return stats;
}

async function importAsset(name, cfg) {
  const src = path.join(root, cfg.src);
  if (!fs.existsSync(src)) { console.warn(`skip ${name}: missing ${cfg.src}`); return null; }
  const doc = await io.read(src);
  const trisIn = triangleCount(doc);

  // 1. bake node transforms + yaw into vertices
  await doc.transform(dedup(), flatten());
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh) transformMesh(mesh, node.getWorldMatrix());
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, mat4(cfg.yaw ?? 0, 1));
  // Generators sometimes get proportions wrong (e.g. 10% too wide); correct per axis.
  if (cfg.axisScale) {
    const [sx, sy, sz] = cfg.axisScale;
    for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1]);
  }

  // 2+3. scale to real size, origin on the ground, centred in x/z
  let bb = bounds(doc);
  const axis = AXES[cfg.measure?.axis ?? 'z'];
  const scale = cfg.measure ? cfg.measure.metres / bb.size[axis] : (cfg.scale ?? 1);
  const cx = (bb.min[0] + bb.max[0]) / 2, cz = (bb.min[2] + bb.max[2]) / 2;
  for (const mesh of doc.getRoot().listMeshes()) {
    transformMesh(mesh, mat4(0, scale, -cx * scale, -bb.min[1] * scale, -cz * scale));
  }
  bb = bounds(doc);

  // 4+5. wheels and parts
  const wheels = (cfg.wheels ?? []).map((w) => ({ width: 0.7, ...w }));
  const split = partition(doc, { wheels, cuts: cfg.cuts ?? [], parts: cfg.parts ?? {} });
  const scene = doc.getRoot().listScenes()[0];
  for (const w of wheels) {
    scene.addChild(doc.createNode(w.name).setTranslation([w.x, w.y, w.z]).setExtras({ radius: w.r, width: w.width }));
  }

  // 6. decimate, textures, compress
  // keepLeaves: the wheel pivots are empty leaf nodes and must survive pruning.
  await doc.transform(weld(), join({ keepNamed: true }), prune({ keepLeaves: true }));
  const trisMid = triangleCount(doc);
  const budget = cfg.triangles ?? 60000;
  if (trisMid > budget) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: budget / trisMid, error: 0.002, lockBorder: false }));
  }
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.texture ?? 2048, cfg.texture ?? 2048], quality: 85 }),
    prune({ keepLeaves: true }),
  );
  // Measure before meshopt: quantization moves the scale into node transforms.
  const final = bounds(doc);
  const trisOut = triangleCount(doc);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  const out = path.join(root, 'public/models', `${name}.glb`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);

  const report = {
    name, src: cfg.src, out: path.relative(root, out),
    bytes: fs.statSync(out).size,
    trianglesIn: trisIn, trianglesOut: trisOut, budget,
    scale: +scale.toFixed(4),
    size: final.size.map((v) => +v.toFixed(3)),
    min: final.min.map((v) => +v.toFixed(3)),
    max: final.max.map((v) => +v.toFixed(3)),
    removedTriangles: split.removed, parts: split.parts,
    wheels: wheels.map(({ name: n, x, y, z, r }) => ({ name: n, x, y, z, r })),
    textures: doc.getRoot().listTextures().map((t) => ({ name: t.getName(), size: t.getSize(), mime: t.getMimeType() })),
    checks: {},
  };
  for (const [k, expected] of Object.entries(cfg.expect ?? {})) {
    // wheelbase: steer axle (wheel_F*) to the centre of the remaining axles
    const mean = (ws) => ws.reduce((t, w) => t + w.z, 0) / ws.length;
    const front = wheels.filter((w) => /^wheel_F/.test(w.name)), rear = wheels.filter((w) => !/^wheel_F/.test(w.name));
    const actual = k === 'wheelbase'
      ? (front.length && rear.length ? mean(rear) - mean(front) : null)
      : k === 'y' ? report.max[1] // height above the ground, even when the tires were stripped
      : report.size[AXES[k]] ?? null;
    const tol = expected * 0.08;
    report.checks[k] = { expected, actual: actual == null ? null : +actual.toFixed(3), ok: actual != null && Math.abs(actual - expected) <= tol };
  }
  return report;
}

const reports = [];
for (const [name, cfg] of Object.entries(manifest.assets)) {
  if (only.length && !only.includes(name)) continue;
  const r = await importAsset(name, cfg);
  if (r) { reports.push(r); console.log(`${name}: ${r.trianglesOut} tris, ${(r.bytes / 1024).toFixed(0)} KB, size ${r.size.join(' x ')} m`); }
}
const reportPath = path.join(root, 'assets/models/bounds-report.json');
const prev = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : {};
for (const r of reports) prev[r.name] = r;
fs.writeFileSync(reportPath, JSON.stringify(prev, null, 2) + '\n');
console.log(`bounds report: ${path.relative(root, reportPath)}`);
