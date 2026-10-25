// Asset bytes come from one of two places: the single-file build embeds every
// file as base64 in window.__BS_ASSETS (fetch() of data: URLs is blocked in the
// artifact sandbox, so we decode bytes ourselves); the Next app fetches them
// from /public.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

declare global {
  interface Window {
    __BS_ASSETS?: Record<string, string>;
  }
}

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function loadBytes(path: string): Promise<ArrayBuffer> {
  const embedded = typeof window !== 'undefined' ? window.__BS_ASSETS?.[path] : undefined;
  if (embedded) return b64ToBytes(embedded).buffer as ArrayBuffer;
  const res = await fetch('/' + path);
  if (!res.ok) throw new Error(`asset ${path}: ${res.status}`);
  return res.arrayBuffer();
}

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

export async function loadModel(name: string): Promise<THREE.Group> {
  const bytes = await loadBytes(`models/${name}.glb`);
  const gltf = await gltfLoader.parseAsync(bytes, '');
  return gltf.scene;
}

export async function loadTexture(path: string, mime = 'image/webp'): Promise<THREE.Texture> {
  const bytes = await loadBytes(path);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }), { imageOrientation: 'flipY' });
  const tex = new THREE.Texture(bitmap);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export const FONTS = [
  { family: 'Anton', file: 'fonts/anton-400.woff2', weight: '400' },
  { family: 'Oswald', file: 'fonts/oswald-500.woff2', weight: '500' },
  { family: 'Oswald', file: 'fonts/oswald-700.woff2', weight: '700' },
];

export async function loadFonts() {
  await Promise.all(
    FONTS.map(async (f) => {
      const face = new FontFace(f.family, await loadBytes(f.file), { weight: f.weight });
      await face.load();
      document.fonts.add(face);
    }),
  );
}
