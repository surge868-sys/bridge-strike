// Browser side of the turntable renderer. Bundled by turntable.mjs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

window.renderTurntable = async (b64, opts = {}) => {
  const W = opts.width ?? 1600, H = opts.height ?? 1000;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8a8f96);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(-8, 12, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const bytes = b64ToBytes(b64);
  const gltf = await new Promise((res, rej) => loader.parse(bytes.buffer, '', res, rej));
  const model = gltf.scene;
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = size.length() / 2;

  // 1 m grid on the ground plane so scale reads at a glance.
  const extent = Math.ceil(Math.max(size.x, size.z) + 4);
  const grid = new THREE.GridHelper(extent * 2, extent * 2, 0x222222, 0x5a5f66);
  grid.position.y = box.min.y + 0.001;
  scene.add(grid);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent * 4, extent * 4), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = box.min.y;
  ground.receiveShadow = true;
  scene.add(ground);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -radius * 1.5;
  sun.shadow.camera.right = sun.shadow.camera.top = radius * 1.5;
  sun.target.position.copy(center);
  scene.add(sun.target);

  // Views: forward is -z, so the front of the vehicle faces -z.
  const views = [
    { name: '3/4 front-left', dir: [-1, 0.45, -1] },
    { name: 'left side', dir: [-1, 0.12, 0] },
    { name: 'front', dir: [0, 0.12, -1] },
    { name: '3/4 rear-right', dir: [1, 0.45, 1] },
  ];
  const cam = new THREE.PerspectiveCamera(30, (W / 2) / (H / 2), 0.05, 500);
  renderer.setScissorTest(true);
  views.forEach((v, i) => {
    const x = (i % 2) * W / 2, y = (i < 2 ? 1 : 0) * H / 2;
    renderer.setViewport(x, y, W / 2, H / 2);
    renderer.setScissor(x, y, W / 2, H / 2);
    const d = new THREE.Vector3(...v.dir).normalize();
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.05;
    cam.position.copy(center).addScaledVector(d, dist);
    cam.lookAt(center);
    renderer.render(scene, cam);
  });

  let tris = 0;
  model.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return { size: size.toArray(), min: box.min.toArray(), max: box.max.toArray(), triangles: tris };
};
