// Terrain, the divided highway, sky dome and sun. Surface textures are canvas
// stand-ins until the generated PBR set lands in M3.
import * as THREE from 'three';
import { RAPIER, G, groups } from './physics';

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

// --- canvas textures ------------------------------------------------------

function noiseCanvas(size: number, base: [number, number, number], spread: number, speckle = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0;
    const n = (vnoise(x / 6, y / 6) - 0.5) * spread + (Math.random() - 0.5) * spread * 0.6;
    const s = speckle && Math.random() < speckle ? 40 : 0;
    img.data[i * 4] = base[0] + n + s;
    img.data[i * 4 + 1] = base[1] + n + s;
    img.data[i * 4 + 2] = base[2] + n * 0.9 + s;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function canvasTexture(c: HTMLCanvasElement, repeatX: number, repeatY: number) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** One carriageway's asphalt with markings; u spans innerEdge-1..outerEdge, v spans 12 m. */
function carriagewayTexture() {
  const W = 1024, H = 1024;
  const c = noiseCanvas(W, [84, 83, 82], 22, 0.02);
  const g = c.getContext('2d')!;
  const width = NB.outerEdge - ROAD.medianHalf; // 8.4 m
  const u = (x: number) => ((x - ROAD.medianHalf) / width) * W;
  const lineW = (0.15 / width) * W;
  // wheel-path wear
  g.fillStyle = 'rgba(30,30,32,0.18)';
  for (const lane of LANES) for (const off of [-0.9, 0.9]) g.fillRect(u(lane.center + off) - 25, 0, 50, H);
  g.fillStyle = '#d9b730'; // yellow left edge line
  g.fillRect(u(NB.innerEdge) - lineW / 2, 0, lineW, H);
  g.fillStyle = '#e8e6df';
  g.fillRect(u(NB.outerEdge) - lineW / 2, 0, lineW, H); // white right edge
  g.fillRect(u(NB.laneLine) - lineW / 2, 0, lineW, (3 / 12) * H); // 3 m dash, 9 m gap
  return canvasTexture(c, 1, (ROAD.half * 2) / 12);
}

// --- build ---------------------------------------------------------------

export interface World {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  sky: THREE.Mesh;
  update(camera: THREE.Camera, focus: THREE.Vector3): void;
}

const SUN_DIR = new THREE.Vector3(-0.85, 0.2, 0.48).normalize(); // low in the west-southwest: long shadows across the road

export function buildWorld(scene: THREE.Scene, world: RAPIER.World): World {
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

  // Terrain mesh
  const terrainGeo = new THREE.PlaneGeometry(size, size, 400, 400);
  terrainGeo.rotateX(-Math.PI / 2);
  const pos = terrainGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  terrainGeo.computeVertexNormals();
  const grass = canvasTexture(noiseCanvas(512, [160, 146, 88], 44), size / 18, size / 18);
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95, metalness: 0 }));
  terrain.receiveShadow = true;
  group.add(terrain);

  // Road surfaces (visual)
  const asphalt = carriagewayTexture();
  const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.85, metalness: 0 });
  const width = NB.outerEdge - ROAD.medianHalf;
  for (const side of [1, -1]) {
    const geo = new THREE.PlaneGeometry(width, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    if (side < 0) geo.scale(-1, 1, 1); // mirror markings for the southbound side
    const m = new THREE.Mesh(geo, roadMat);
    m.position.set(side * (ROAD.medianHalf + width / 2), 0.0, 0);
    m.receiveShadow = true;
    group.add(m);
  }
  const gravel = canvasTexture(noiseCanvas(256, [150, 136, 114], 50, 0.08), 1, size / 4);
  const gravelMat = new THREE.MeshStandardMaterial({ map: gravel, roughness: 1 });
  for (const side of [1, -1]) {
    const geo = new THREE.PlaneGeometry(ROAD.outerShoulder, size);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, gravelMat);
    m.position.set(side * (NB.outerEdge + ROAD.outerShoulder / 2), -0.01, 0);
    m.receiveShadow = true;
    group.add(m);
  }
  const median = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD.medianHalf * 2, size).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: canvasTexture(noiseCanvas(512, [146, 146, 82], 44), 1, size / 14), roughness: 1 }),
  );
  median.position.y = -0.02;
  median.receiveShadow = true;
  group.add(median);

  // Power poles along the east side for a sense of speed (procedural stand-in until M3).
  const poleGeo = new THREE.CylinderGeometry(0.13, 0.17, 11, 7).translate(0, 5.5, 0);
  const armGeo = new THREE.BoxGeometry(2.4, 0.14, 0.14).translate(0, 10.2, 0);
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.9 });
  const count = Math.floor(size / 55);
  const poles = new THREE.InstancedMesh(poleGeo, wood, count);
  const arms = new THREE.InstancedMesh(armGeo, wood, count);
  const m4 = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    const z = -ROAD.half + k * 55, x = 34;
    m4.makeTranslation(x, terrainHeight(x, z), z);
    poles.setMatrixAt(k, m4);
    arms.setMatrixAt(k, m4);
  }
  poles.castShadow = arms.castShadow = true;
  group.add(poles, arms);

  // Sky dome: follows the camera and sits well inside the far plane.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { sunDir: { value: SUN_DIR } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 zenith = vec3(0.24, 0.42, 0.72);
          vec3 horizon = vec3(1.0, 0.72, 0.46);
          vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
          float s = max(dot(vDir, sunDir), 0.0);
          col += vec3(1.0, 0.62, 0.3) * pow(s, 8.0) * 0.55 + vec3(1.0, 0.9, 0.7) * pow(s, 900.0) * 4.0;
          col = mix(col, vec3(0.62, 0.55, 0.45), smoothstep(0.0, -0.2, vDir.y));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  scene.fog = new THREE.Fog(0xe6b98a, 250, 1700);
  scene.add(new THREE.HemisphereLight(0xb4c8e8, 0x8a7550, 1.1));
  const sun = new THREE.DirectionalLight(0xffc690, 4.2);
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

  return {
    group,
    sun,
    sky,
    update(camera, focus) {
      sky.position.copy(camera.position);
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(SUN_DIR, 200);
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
