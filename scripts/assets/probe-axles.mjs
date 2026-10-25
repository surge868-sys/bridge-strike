// Finds axle positions in a raw GLB from where the tires touch the ground.
// Usage: node scripts/assets/probe-axles.mjs <in.glb> <yawDeg> <lengthMetres>
// Prints contact clusters along z (after yaw, scaled so overall length = lengthMetres,
// origin centred, ground at y=0) so wheel hubs can be written into the manifest.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [, , file, yawArg = '0', lenArg = '1'] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const yaw = (+yawArg * Math.PI) / 180, c = Math.cos(yaw), s = Math.sin(yaw);
const pts = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
      const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
      const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
      pts.push([c * x + s * z, y, -s * x + c * z]);
    }
  }
}
const min = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
const max = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
const scale = +lenArg / (max[2] - min[2]);
const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
const P = pts.map((p) => [(p[0] - cx) * scale, (p[1] - min[1]) * scale, (p[2] - cz) * scale]);
const H = (max[1] - min[1]) * scale;
console.log('size m:', ((max[0] - min[0]) * scale).toFixed(2), H.toFixed(2), lenArg);
// Ground contacts: vertices within 2 cm of the ground.
const contacts = P.filter((p) => p[1] < 0.02).sort((a, b) => a[2] - b[2]);
const clusters = [];
for (const p of contacts) {
  const last = clusters[clusters.length - 1];
  if (last && p[2] - last.maxZ < 0.15) { last.maxZ = p[2]; last.n++; last.sumZ += p[2]; last.minX = Math.min(last.minX, p[0]); last.maxX = Math.max(last.maxX, p[0]); }
  else clusters.push({ minZ: p[2], maxZ: p[2], sumZ: p[2], n: 1, minX: p[0], maxX: p[0] });
}
for (const cl of clusters) console.log(`contact z ${cl.minZ.toFixed(2)}..${cl.maxZ.toFixed(2)} centre ${(cl.sumZ / cl.n).toFixed(2)}  x ${cl.minX.toFixed(2)}..${cl.maxX.toFixed(2)}  n=${cl.n}`);
// Tire top: highest point of tire-ish verts near each contact centre, |x| > 0.8 m.
for (const cl of clusters) {
  const zc = cl.sumZ / cl.n;
  const near = P.filter((p) => Math.abs(p[2] - zc) < 0.08 && Math.abs(p[0]) > 0.75);
  const outer = Math.max(...near.map((p) => Math.abs(p[0])));
  console.log(`  near z ${zc.toFixed(2)}: outer |x| ${outer.toFixed(2)}`);
}
// Tire profile per contact: radius from the hub and x span of verts in the wheel zone.
for (const cl of clusters) {
  const zc = cl.sumZ / cl.n;
  const ring = P.filter((p) => Math.abs(p[2] - zc) < 0.75 && p[1] < 1.3 && p[0] < 0);
  // estimate hub height as the y that makes the front-most / rear-most extents symmetric
  const zs = ring.filter((p) => p[1] > 0.4 && p[1] < 0.7).map((p) => p[2]);
  const zmin = Math.min(...zs), zmax = Math.max(...zs);
  const ys = ring.filter((p) => Math.abs(p[2] - zc) < 0.05).map((p) => p[1]);
  console.log(`  z ${zc.toFixed(2)}: z extent at hub height ${zmin.toFixed(2)}..${zmax.toFixed(2)} (r~${((zmax - zmin) / 2).toFixed(2)}), top of column y ${Math.max(...ys).toFixed(2)}`);
  const xs = ring.filter((p) => Math.abs(p[2] - zc) < 0.3 && p[1] < 0.3).map((p) => p[0]);
  console.log(`     tread x ${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)}`);
}

// Radius: within the tread x band, horizontal extent of verts at mid height.
const bands = [[-1.33, -0.96], [-1.44, -0.62], [-1.44, -0.62]];
clusters.forEach((cl, i) => {
  const zc = cl.sumZ / cl.n, [x0, x1] = bands[i] ?? bands[1];
  for (const yh of [0.35, 0.45, 0.5, 0.55, 0.6]) {
    const zs = P.filter((p) => p[0] >= x0 && p[0] <= x1 && Math.abs(p[1] - yh) < 0.02 && Math.abs(p[2] - zc) < 0.8).map((p) => p[2]);
    if (zs.length) console.log(`  axle ${zc.toFixed(2)} y=${yh}: z ${Math.min(...zs).toFixed(2)}..${Math.max(...zs).toFixed(2)} half ${((Math.max(...zs) - Math.min(...zs)) / 2).toFixed(2)}`);
  }
});
