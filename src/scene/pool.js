/* pool.js — the shallow reflecting pool in the middle of the courtyard.

   A stone curb around a sheet of water at y = SURFACE_Y. The water is a
   planar mirror (three's Reflector renders the scene from below the surface,
   fire included) with its own shader on top:
     - slow wind ripples + up to 8 ripple RINGS from things landing in it
       bend the reflection and the view of the bottom
     - Fresnel: look straight down and you see the paving through shallow,
       mossy water; look across it and it turns to mirror
   Ripple rings come from addRipple(x, z, strength); the game calls it when a
   burning arrow drops in (and steams out). */
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

export const POOL = { x0: -4.2, x1: 4.2, z0: -15.5, z1: -3.5 };   // the water (metres): big and close, just past the drum kit (owner, 2026-10-02)
export const SURFACE_Y = 0.17;
const CURB_W = 0.35, CURB_H = 0.28;
const MAX_RIPPLES = 8;

export function poolContains(x, z, inset = 0) {
  return x > POOL.x0 + inset && x < POOL.x1 - inset && z > POOL.z0 + inset && z < POOL.z1 - inset;
}

const WaterShader = {
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uBottom: { value: null },
    uBottomScale: { value: new THREE.Vector2(1 / 2.5, 1 / 2.5) },   // the paving tiles every 2.5 m (courtyard.js STONE_TILE)
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUvR;
    varying vec3 vWorld;
    void main() {
      vUvR = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    #define MAX_RIPPLES ${MAX_RIPPLES}
    uniform sampler2D tDiffuse, uBottom;
    uniform vec2 uBottomScale;
    uniform float uTime;
    uniform vec4 uRipples[MAX_RIPPLES];      // x, z, start time, strength
    varying vec4 vUvR;
    varying vec3 vWorld;

    // height of the water surface: gentle wind + expanding rings
    float waves(vec2 p) {
      float h = 0.0;
      h += sin(dot(p, vec2(1.3, 0.7)) * 3.1 + uTime * 1.1) * 0.0040;
      h += sin(dot(p, vec2(-0.6, 1.4)) * 4.7 + uTime * 1.6) * 0.0025;
      h += sin(dot(p, vec2(0.9, -1.1)) * 9.3 + uTime * 2.3) * 0.0012;
      for (int i = 0; i < MAX_RIPPLES; i++) {
        vec4 r = uRipples[i];
        float age = uTime - r.z;
        if (age < 0.0 || age > 4.0) continue;
        float d = distance(p, r.xy);
        float front = age * 0.9;                       // ring speed, m/s
        float env = exp(-abs(d - front) * 5.0) * exp(-age * 1.1) * r.w;
        h += sin((d - front) * 22.0) * 0.012 * env;
      }
      return h;
    }

    void main() {
      // surface normal from the height field (central differences)
      vec2 p = vWorld.xz;
      float e = 0.02;
      float hx = waves(p + vec2(e, 0.0)) - waves(p - vec2(e, 0.0));
      float hz = waves(p + vec2(0.0, e)) - waves(p - vec2(0.0, e));
      vec3 N = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
      vec3 V = normalize(cameraPosition - vWorld);

      // reflection: the mirror image, bent by the ripples
      vec2 ruv = vUvR.xy / vUvR.w + N.xz * 0.06;
      vec3 refl = texture2D(tDiffuse, ruv).rgb;

      // the bottom, seen through ~15 cm of water: refracted, darkened, mossy
      vec2 buv = (p - N.xz * 0.08) * uBottomScale;
      vec3 bottom = texture2D(uBottom, buv).rgb;
      bottom = bottom * bottom;                         // the paving map is sRGB: rough linearise
      bottom *= vec3(0.16, 0.20, 0.18);                 // light lost in the water, a green-grey tint

      float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);   // Fresnel (water)
      vec3 col = mix(bottom, refl * 1.1, clamp(F * 1.3 + 0.2, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/**
 * @param {THREE.Scene} scene
 * @param {{ bottomMap: THREE.Texture, layer?: number, resolution?: number }} opts
 */
export function createPool(scene, { bottomMap, layer = 0, resolution = 0.5 } = {}) {
  const root = new THREE.Group();
  root.name = "pool";
  scene.add(root);
  const W = POOL.x1 - POOL.x0, D = POOL.z1 - POOL.z0;
  const cx = (POOL.x0 + POOL.x1) / 2, cz = (POOL.z0 + POOL.z1) / 2;

  // --- the curb: four stone blocks, with a slightly darker, wetter inner face
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xb8956b, roughness: 0.85 });
  const curb = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, CURB_H, d), curbMat);
    m.position.set(x, CURB_H / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
  };
  curb(W + 2 * CURB_W, CURB_W, cx, POOL.z0 - CURB_W / 2);
  curb(W + 2 * CURB_W, CURB_W, cx, POOL.z1 + CURB_W / 2);
  curb(CURB_W, D, POOL.x0 - CURB_W / 2, cz);
  curb(CURB_W, D, POOL.x1 + CURB_W / 2, cz);

  // --- the water: a mirror with the shader above
  const dpr = window.devicePixelRatio || 1;
  const water = new Reflector(new THREE.PlaneGeometry(W, D), {
    shader: WaterShader,
    textureWidth: Math.round(window.innerWidth * dpr * resolution),
    textureHeight: Math.round(window.innerHeight * dpr * resolution),
    clipBias: 0.003,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, SURFACE_Y, cz);
  water.layers.set(layer);
  water.camera.layers.enableAll();          // the mirror sees everything, fire included
  const U = water.material.uniforms;
  U.uBottom.value = bottomMap;
  root.add(water);

  let next = 0;
  return {
    root,
    water,
    /** a ring spreading from (x, z); strength 0..1 */
    addRipple(x, z, strength = 1) {
      U.uRipples.value[next++ % MAX_RIPPLES].set(x, z, U.uTime.value, strength);
    },
    update(t) { U.uTime.value = t; },
  };
}
