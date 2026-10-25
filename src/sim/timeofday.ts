// Lighting presets. Golden hour is the default; T and the dispatch sheet cycle them.
import * as THREE from 'three';

export type TimeOfDay = 'golden' | 'midday' | 'dusk';

export interface LightPreset {
  id: TimeOfDay;
  label: string;
  sunDir: THREE.Vector3;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  glow: THREE.Color; // halo around the sun
  fog: number;
  fogNear: number;
  fogFar: number;
  exposure: number;
  envIntensity: number;
  envGround: number;
  grade: { lift: THREE.Color; gain: THREE.Color; saturation: number; vignette: number };
  bloom: number;
  skylineHaze: number; // 0..1 mix toward the fog colour
  headlights: number; // 0 off, 1 full
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();
const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

export const TIMES: LightPreset[] = [
  {
    id: 'golden',
    label: 'GOLDEN HOUR',
    sunDir: v(-0.85, 0.2, 0.48), // low in the west-southwest: long shadows across the road
    sun: 0xffc690,
    sunIntensity: 4.2,
    hemiSky: 0xb4c8e8,
    hemiGround: 0x8a7550,
    hemiIntensity: 1.1,
    zenith: c(0.24, 0.42, 0.72),
    horizon: c(1.0, 0.72, 0.46),
    glow: c(1.0, 0.62, 0.3),
    fog: 0xe6b98a,
    fogNear: 260,
    fogFar: 2300,
    exposure: 1.3,
    envIntensity: 0.8,
    envGround: 0x6f6446,
    grade: { lift: c(0.018, 0.01, 0.0), gain: c(1.03, 1.0, 0.95), saturation: 1.08, vignette: 0.28 },
    bloom: 0.32,
    skylineHaze: 0.42,
    headlights: 0,
  },
  {
    id: 'midday',
    label: 'MIDDAY',
    sunDir: v(-0.35, 0.86, 0.38),
    sun: 0xfff3e2,
    sunIntensity: 3.4,
    hemiSky: 0xbfd6f2,
    hemiGround: 0x8c7e5c,
    hemiIntensity: 1.0,
    zenith: c(0.16, 0.36, 0.78),
    horizon: c(0.74, 0.84, 0.94),
    glow: c(1.0, 0.95, 0.85),
    fog: 0xc6d4e0,
    fogNear: 320,
    fogFar: 2500,
    exposure: 1.0,
    envIntensity: 0.9,
    envGround: 0x7a6e50,
    grade: { lift: c(0.0, 0.004, 0.01), gain: c(1.0, 1.0, 1.0), saturation: 1.06, vignette: 0.2 },
    bloom: 0.2,
    skylineHaze: 0.5,
    headlights: 0,
  },
  {
    id: 'dusk',
    label: 'DUSK',
    sunDir: v(-0.9, 0.035, 0.42),
    sun: 0xff7438,
    sunIntensity: 1.7,
    hemiSky: 0x6c7cae,
    hemiGround: 0x3e3236,
    hemiIntensity: 0.95,
    zenith: c(0.09, 0.13, 0.32),
    horizon: c(0.98, 0.46, 0.28),
    glow: c(1.0, 0.4, 0.2),
    fog: 0x9a6c6c,
    fogNear: 160,
    fogFar: 1900,
    exposure: 1.55,
    envIntensity: 0.6,
    envGround: 0x2e2622,
    grade: { lift: c(0.0, 0.004, 0.022), gain: c(1.04, 0.97, 1.0), saturation: 1.1, vignette: 0.36 },
    bloom: 0.55,
    skylineHaze: 0.3,
    headlights: 1,
  },
];

export const timeById = (id: TimeOfDay) => TIMES.find((t) => t.id === id) ?? TIMES[0];
