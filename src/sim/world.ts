// Terrain, the divided highway, sky dome and sun. Ground colour comes from the
// generated tiles; normal maps are derived from them at load time.
import * as THREE from 'three';
import { RAPIER, G, groups } from './physics';
import type { LightPreset } from './timeofday';

// Cross-section of the highway (metres from the median centre line, +x is the
// northbound side; the truck drives toward -z).
export const ROAD = {
  medianHalf: 7,
  innerShoulder: 1,
  lane: 3.7,
  outerShoulder: 2.6,
  half: 1000, // terrain and road run z in [-1000, 1000]
};
export const NB = {
  innerEdge: ROAD.medianHalf + ROAD.innerShoulder, // 8.0
  laneLine: ROAD.medianHalf + ROAD.innerShoulder + ROAD.lane, // 11.7
  outerEdge: ROAD.medianHalf + ROAD.innerShoulder + 2 * ROAD.lane, // 15.4
  gravelEdge: ROAD.medianHalf + ROAD.innerShoulder + 2 * ROAD.lane + ROAD.outerShoulder, // 18.0
};
export const LANES = [
  { name: 'LEFT', center: (NB.innerEdge + NB.laneLine) / 2, min: NB.innerEdge, max: NB.laneLine },
  { name: 'RIGHT', center: (NB.laneLine + NB.outerEdge) / 2, min: NB.laneLine, max: NB.outerEdge },
];

// --- terrain height -------------------------------------------------------

function hash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, z: number) {
  let f = 0, amp = 1, freq = 1 / 420;
  for (let o = 0; o < 4; o++) { f += (vnoise(x * freq, z * freq) - 0.5) * amp; amp *= 0.45; freq *= 2.1; }
  return f;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Ground height away from the paved corridor (|x| > 18). Gentle prairie, ditches beside the road. */
export function terrainHeight(x: number, z: number) {
  const ax = Math.abs(x);
  if (ax < NB.gravelEdge) return -0.35; // under the road collider; never visible
  const ditch = ax < 30 ? -1.1 * Math.sin((Math.PI * (ax - NB.gravelEdge)) / (30 - NB.gravelEdge)) : 0;
  const rolling = fbm(x, z) * 7 * smooth(30, 110, ax);
  return ditch + rolling - 0.05;
}

// --- textures ------------------------------------------------------------

export interface GroundTextures {
  asphalt: THREE.Texture;
  gravel: THREE.Texture;
  grass: THREE.Texture;
  stubble: THREE.Texture;
}

/** Tangent-space normal map from a colour tile's luminance (Sobel), wrapping at the edges. */
export function normalFromTexture(tex: THREE.Texture, strength = 2.5) {
  const img = tex.image as ImageBitmap;
  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const src = g.getImageData(0, 0, W, H).data;
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = (0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / 255;
  const at = (x: number, y: number) => h[((y + H) % H) * W + ((x + W) % W)];
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    // Canvas rows run with texture v (the bitmap was decoded flipped), so dy is dh/dv.
    let nx = -dx * strength, ny = -dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    const o = (y * W + x) * 4;
    out[o] = (nx * 0.5 + 0.5) * 255;
    out[o + 1] = (ny * 0.5 + 0.5) * 255;
    out[o + 2] = (nz * 0.5 + 0.5) * 255;
    out[o + 3] = 255;
  }
  const t = new THREE.DataTexture(out, W, H);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const tiled = (tex: THREE.Texture, rx: number, ry: number) => {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
};

/** Lane markings and wheel-path wear on a transparent canvas; u spans medianHalf..outerEdge, v spans 12 m. */
function markingsTexture(lengthM: number) {
  const W = 512, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const width = NB.outerEdge - ROAD.medianHalf; // 8.4 m
  const u = (x: number) => ((x - ROAD.medianHalf) / width) * W;
  const lineW = (0.15 / width) * W;
  // wheel-path polish and oil stain down the lane centres
  for (const lane of LANES) {
    for (const off of [-0.9, 0.9]) {
      const grad = g.createLinearGradient(u(lane.center + off) - 14, 0, u(lane.center + off) + 14, 0);
      grad.addColorStop(0, 'rgba(20,20,22,0)');
      grad.addColorStop(0.5, 'rgba(20,20,22,0.22)');
      grad.addColorStop(1, 'rgba(20,20,22,0)');
      g.fillStyle = grad;
      g.fillRect(u(lane.center + off) - 14, 0, 28, H);
    }
    const grad = g.createLinearGradient(u(lane.center) - 20, 0, u(lane.center) + 20, 0);
    grad.addColorStop(0, 'rgba(15,12,10,0)');
    grad.addColorStop(0.5, 'rgba(15,12,10,0.16)');
    grad.addColorStop(1, 'rgba(15,12,10,0)');
    g.fillStyle = grad;
    g.fillRect(u(lane.center) - 20, 0, 40, H);
  }
  // worn paint: draw lines, then knock random flecks out of them
  g.fillStyle = '#d9b730'; // yellow left edge line
  g.fillRect(u(NB.innerEdge) - lineW / 2, 0, lineW, H);
  g.fillStyle = '#ecebe4';
  g.fillRect(u(NB.outerEdge) - lineW / 2, 0, lineW, H); // white right edge
  g.fillRect(u(NB.laneLine) - lineW / 2, 0, lineW, (3 / 12) * H); // 3 m dash, 9 m gap
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.5})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 1 + Math.random() * 4);
  }
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, lengthM / 12);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// --- terrain mesh -----------------------------------------------------------

/** Grid coordinates: `fine` spacing inside |v| < inner, growing geometrically out to `outer`. */
function axis(fineBands: [number, number][], inner: number, outer: number) {
  const pos: number[] = [];
  const spacing = (a: number) => {
    for (const [lim, s] of fineBands) if (a <= lim) return s;
    return fineBands[fineBands.length - 1][1];
  };
  let x = 0;
  pos.push(0);
  while (x < inner) { x += spacing(x); pos.push(Math.min(x, inner)); }
  let s = spacing(inner);
  while (x < outer) { s *= 1.12; x += s; pos.push(Math.min(x, outer)); }
  const neg = pos.slice(1).map((p) => -p).reverse();
  return [...neg, ...pos];
}

function terrainGeometry(xs: number[], zs: number[]) {
  const nx = xs.length, nz = zs.length;
  const position = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = xs[i], z = zs[j];
    position[k * 3] = x;
    position[k * 3 + 1] = terrainHeight(x, z);
    position[k * 3 + 2] = z;
    // world metres; v runs north (-z) so the tangent frame matches PlaneGeometry's
    uv[k * 2] = x;
    uv[k * 2 + 1] = -z;
  }
  const index: number[] = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// Field patchwork: quarter-mile cells split into strips; stubble, pasture or
// worked fallow, each with its own tint and row direction. Grass in the ditches.
const FIELD_GLSL = /* glsl */ `
  float fHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(fHash(i), fHash(i+vec2(1,0)), u.x), mix(fHash(i+vec2(0,1)), fHash(i+vec2(1,1)), u.x), u.y); }
`;

function terrainMaterial(tex: GroundTextures, grassN: THREE.Texture, stubbleN: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, normalMap: grassN, normalScale: new THREE.Vector2(0.9, 0.9) });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.grassMap = { value: tex.grass };
    shader.uniforms.stubbleMap = { value: tex.stubble };
    shader.uniforms.stubbleNormal = { value: stubbleN };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D grassMap; uniform sampler2D stubbleMap; uniform sampler2D stubbleNormal;\n${FIELD_GLSL}`)
      .replace('#include <map_fragment>', /* glsl */ `
        vec2 wp = vNormalMapUv;
        vec2 cellSize = vec2(400.0, 400.0);
        vec2 cell = floor(wp / cellSize);
        vec2 fc = fract(wp / cellSize);
        float h0 = fHash(cell);
        // half the quarters are split into two strips
        float split = step(0.5, fHash(cell + 17.0));
        vec2 sub = split > 0.5 ? vec2(cell.x, cell.y * 2.0 + step(0.5, fc.y)) : cell;
        float h = fHash(sub + 3.1);
        float rot = step(0.5, fHash(sub + 9.7));
        // 0 pasture, 1 stubble, 2 dark worked fallow
        float kind = h < 0.32 ? 0.0 : (h < 0.84 ? 1.0 : 2.0);
        float road = 1.0 - smoothstep(24.0, 36.0, abs(wp.x));
        // headlands and road allowances stay grassy
        vec2 edge = min(fc, 1.0 - fc) * cellSize;
        float headland = 1.0 - smoothstep(3.0, 9.0, min(edge.x, edge.y));
        float cropMask = (kind > 0.5 ? 1.0 : 0.0) * (1.0 - road) * (1.0 - headland);
        vec2 sUv = rot > 0.5 ? wp.yx : wp;
        float macro = fNoise(wp / 60.0) * 0.6 + fNoise(wp / 13.0) * 0.4;
        vec3 g1 = texture2D(grassMap, wp / 7.0).rgb;
        vec3 g2 = texture2D(grassMap, wp.yx / 23.0 + 0.37).rgb;
        vec3 grassCol = mix(g1, g2, smoothstep(0.35, 0.65, fNoise(wp / 31.0)));
        grassCol *= mix(vec3(0.9, 0.86, 0.72), vec3(1.05, 1.06, 1.0), fHash(sub + 1.3)) * (0.85 + macro * 0.3);
        grassCol = mix(grassCol, grassCol * vec3(0.92, 1.02, 0.86), road); // greener ditches
        vec3 s1 = texture2D(stubbleMap, sUv / 5.5).rgb;
        vec3 s2 = texture2D(stubbleMap, sUv / 17.0 + 0.21).rgb;
        vec3 stubbleCol = mix(s1, s2, 0.35) * mix(vec3(0.92, 0.84, 0.7), vec3(1.06, 1.0, 0.9), fHash(sub + 5.1)) * (0.88 + macro * 0.24);
        vec3 fallow = stubbleCol * vec3(0.42, 0.34, 0.27);
        vec3 crop = kind > 1.5 ? fallow : stubbleCol;
        diffuseColor.rgb *= mix(grassCol, crop, cropMask);
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 nG = texture2D(normalMap, wp / 7.0).xyz * 2.0 - 1.0;
          vec3 nS = texture2D(stubbleNormal, sUv / 5.5).xyz * 2.0 - 1.0;
          if (rot > 0.5) nS.xy = nS.yx;
          vec3 mapN = normalize(mix(nG, nS, cropMask));
          mapN.xy *= normalScale;
          normal = normalize(tbn * mapN);
        #endif
      `);
  };
  return mat;
}

// --- build ---------------------------------------------------------------

export interface World {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  sky: THREE.Mesh;
  hemi: THREE.HemisphereLight;
  sunDir: THREE.Vector3;
  apply(p: LightPreset): void;
  update(camera: THREE.Camera, focus: THREE.Vector3): void;
}

/** Visual extent of terrain and road: far enough that the edge sits inside the fog. */
export const VIEW_HALF = 3200;

/** `overpassZ` keeps the pole line out of the overpass abutments. */
export function buildWorld(scene: THREE.Scene, world: RAPIER.World, tex: GroundTextures, overpassZ: number[] = []): World {
  const group = new THREE.Group();
  scene.add(group);

  // Physics: one flat slab for both carriageways and the median, plus a heightfield.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(NB.gravelEdge, 0.5, ROAD.half)
      .setTranslation(0, -0.5, 0)
      .setFriction(1.0)
      .setCollisionGroups(groups(G.GROUND, 0xffff)),
  );
  const N = 256;
  const size = ROAD.half * 2;
  const heights = new Float32Array((N + 1) * (N + 1));
  // Rapier heightfields are column-major: element (row i along z, col j along x) at i + j*(N+1).
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = -ROAD.half + (j / N) * size, z = -ROAD.half + (i / N) * size;
    heights[i + j * (N + 1)] = terrainHeight(x, z);
  }
  world.createCollider(
    RAPIER.ColliderDesc.heightfield(N, N, heights, { x: size, y: 1, z: size })
      .setFriction(0.9)
      .setCollisionGroups(groups(G.GROUND, 0xffff)),
  );

  // Terrain mesh: dense by the road, coarse toward the horizon, one piece so no seams.
  const xs = axis([[NB.gravelEdge, 3], [32, 1.5], [120, 5], [600, 10], [1200, 16]], 1200, VIEW_HALF);
  const zs = axis([[1200, 8]], 1200, VIEW_HALF);
  const grassN = normalFromTexture(tex.grass, 3);
  const stubbleN = normalFromTexture(tex.stubble, 3);
  const terrain = new THREE.Mesh(terrainGeometry(xs, zs), terrainMaterial(tex, grassN, stubbleN));
  terrain.receiveShadow = true;
  group.add(terrain);

  // Road surfaces (visual)
  const len = VIEW_HALF * 2;
  const width = NB.outerEdge - ROAD.medianHalf;
  const asphaltN = normalFromTexture(tex.asphalt, 1.6);
  const roadMat = new THREE.MeshStandardMaterial({
    map: tiled(tex.asphalt, width / 4.2, len / 4.2),
    normalMap: tiled(asphaltN, width / 4.2, len / 4.2),
    normalScale: new THREE.Vector2(0.6, 0.6),
    color: 0x7a7874,
    roughness: 0.88,
    metalness: 0,
  });
  const markMat = new THREE.MeshStandardMaterial({
    map: markingsTexture(len),
    transparent: true,
    depthWrite: false,
    roughness: 0.75,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  for (const side of [1, -1]) {
    const geo = new THREE.PlaneGeometry(width, len, 1, 1);
    geo.rotateX(-Math.PI / 2);
    if (side < 0) geo.scale(-1, 1, 1); // mirror markings for the southbound side
    const m = new THREE.Mesh(geo, roadMat);
    m.position.set(side * (ROAD.medianHalf + width / 2), 0.0, 0);
    m.receiveShadow = true;
    const marks = new THREE.Mesh(geo, markMat);
    marks.position.copy(m.position);
    marks.position.y = 0.004;
    marks.receiveShadow = true;
    marks.renderOrder = 1;
    group.add(m, marks);
  }
  const gravelN = normalFromTexture(tex.gravel, 3);
  const gravelMat = new THREE.MeshStandardMaterial({
    map: tiled(tex.gravel, 1, len / 2.6),
    normalMap: tiled(gravelN, 1, len / 2.6),
    color: 0xd8d0c4,
    roughness: 1,
  });
  for (const side of [1, -1]) {
    const geo = new THREE.PlaneGeometry(ROAD.outerShoulder, len);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, gravelMat);
    m.position.set(side * (NB.outerEdge + ROAD.outerShoulder / 2), -0.01, 0);
    m.receiveShadow = true;
    group.add(m);
  }
  const median = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD.medianHalf * 2, len).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      map: tiled(tex.grass, (ROAD.medianHalf * 2) / 7, len / 7),
      normalMap: tiled(grassN, (ROAD.medianHalf * 2) / 7, len / 7),
      color: 0xe4ead8,
      roughness: 1,
    }),
  );
  median.position.y = -0.02;
  median.receiveShadow = true;
  group.add(median);

  // Power poles along the east side for a sense of speed.
  const poleGeo = new THREE.CylinderGeometry(0.13, 0.17, 11, 7).translate(0, 5.5, 0);
  const armGeo = new THREE.BoxGeometry(2.4, 0.14, 0.14).translate(0, 10.2, 0);
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.9 });
  const poleZ: number[] = [];
  for (let z = -VIEW_HALF; z < VIEW_HALF; z += 55) if (overpassZ.every((oz) => Math.abs(z - oz) > 14)) poleZ.push(z);
  const poles = new THREE.InstancedMesh(poleGeo, wood, poleZ.length);
  const arms = new THREE.InstancedMesh(armGeo, wood, poleZ.length);
  const m4 = new THREE.Matrix4();
  poleZ.forEach((z, k) => {
    const x = 34;
    m4.makeTranslation(x, terrainHeight(x, z), z);
    poles.setMatrixAt(k, m4);
    arms.setMatrixAt(k, m4);
  });
  poles.castShadow = arms.castShadow = true;
  group.add(poles, arms);

  // Sky dome: follows the camera and sits well inside the far plane. The band at
  // and below the horizon is the fog colour, so fogged terrain meets it seamlessly.
  const skyUniforms = {
    sunDir: { value: new THREE.Vector3() },
    zenith: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    glow: { value: new THREE.Color() },
    fogColor: { value: new THREE.Color() },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: skyUniforms,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 sunDir; uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; uniform vec3 fogColor; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
          float s = max(dot(d, sunDir), 0.0);
          col += glow * pow(s, 8.0) * 0.55 + vec3(1.0, 0.9, 0.7) * pow(s, 900.0) * 4.0;
          col = mix(fogColor, col, smoothstep(-0.005, 0.06, d.y));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const fog = new THREE.Fog(0xffffff, 260, 2300);
  scene.fog = fog;
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -45;
  sc.right = sc.top = 45;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const sunDir = new THREE.Vector3();
  return {
    group,
    sun,
    sky,
    hemi,
    sunDir,
    apply(p) {
      sunDir.copy(p.sunDir);
      skyUniforms.sunDir.value.copy(p.sunDir);
      skyUniforms.zenith.value.copy(p.zenith);
      skyUniforms.horizon.value.copy(p.horizon);
      skyUniforms.glow.value.copy(p.glow);
      fog.color.set(p.fog);
      fog.near = p.fogNear;
      fog.far = p.fogFar;
      skyUniforms.fogColor.value.copy(fog.color);
      hemi.color.set(p.hemiSky);
      hemi.groundColor.set(p.hemiGround);
      hemi.intensity = p.hemiIntensity;
      sun.color.set(p.sun);
      sun.intensity = p.sunIntensity;
    },
    update(camera, focus) {
      sky.position.copy(camera.position);
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(sunDir, 200);
    },
  };
}

/** Green "SASKATOON / CITY LIMITS" sign on the right shoulder at the delivery line. */
export function buildCityLimits(scene: THREE.Scene, z: number) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b6b3a';
  g.fillRect(0, 0, 1024, 512);
  g.strokeStyle = '#fff';
  g.lineWidth = 16;
  g.strokeRect(20, 20, 984, 472);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = '190px Anton, Impact, sans-serif';
  g.fillText('SASKATOON', 512, 270);
  g.font = '500 84px Oswald, sans-serif';
  g.fillText('CITY LIMITS', 512, 410);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  panel.position.set(0, 3.6, 0);
  const back = new THREE.Mesh(new THREE.BoxGeometry(5.1, 2.6, 0.08), new THREE.MeshStandardMaterial({ color: 0x7d8288, metalness: 0.6, roughness: 0.5 }));
  back.position.set(0, 3.6, -0.06);
  group.add(panel, back);
  for (const px of [-1.8, 1.8]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.8, 8), new THREE.MeshStandardMaterial({ color: 0x8a8f94, metalness: 0.7, roughness: 0.4 }));
    post.position.set(px, 2.4, -0.15);
    post.castShadow = true;
    group.add(post);
  }
  group.position.set(NB.gravelEdge + 3.2, 0, z);
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  scene.add(group);
  return group;
}
