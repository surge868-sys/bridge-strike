// Post stack: MSAA half-float scene target -> bloom -> grade + vignette -> tone map.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { LightPreset } from './timeofday';

// Runs in linear HDR, before OutputPass applies ACES and sRGB.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    lift: { value: new THREE.Color() },
    gain: { value: new THREE.Color(1, 1, 1) },
    saturation: { value: 1 },
    vignette: { value: 0.3 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec3 lift; uniform vec3 gain; uniform float saturation; uniform float vignette; uniform float aspect;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = max(mix(vec3(l), c.rgb, saturation), 0.0);
      c.rgb = c.rgb * gain + lift * (1.0 - clamp(l, 0.0, 1.0));
      vec2 d = vUv - 0.5; d.x *= aspect;
      c.rgb *= 1.0 - vignette * smoothstep(0.3, 0.95, length(d));
      gl_FragColor = c;
    }`,
};

export interface Post {
  render(): void;
  setSize(w: number, h: number): void;
  apply(p: LightPreset): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Post | null {
  if (!renderer.capabilities.isWebGL2) return null;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // UnrealBloomPass starts its blur chain at half resolution.
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.55, 0.92);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return {
    render: () => composer.render(),
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      grade.uniforms.aspect.value = w / h;
    },
    apply(p) {
      bloom.strength = p.bloom;
      grade.uniforms.lift.value.copy(p.grade.lift);
      grade.uniforms.gain.value.copy(p.grade.gain);
      grade.uniforms.saturation.value = p.grade.saturation;
      grade.uniforms.vignette.value = p.grade.vignette;
    },
  };
}
