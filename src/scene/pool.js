/* pool.js — the reflecting water, since 2026-10-07 INSIDE THE FOUNTAIN's basin (see createPool).

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

export const POOL = { x0: -4.2, x1: 4.2, z0: -15.5, z1: -3.5, y: 0.17 };   // updated live to the fountain's water (createPool)   // the water (metres): big and close, just past the drum kit (owner, 2026-10-02)
export const SURFACE_Y = 0.17;
const MAX_RIPPLES = 6;

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
    uPool: { value: new THREE.Vector4(POOL.x0, POOL.x1, POOL.z0, POOL.z1) },   // the walls the ripples bounce off
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
    uniform vec4 uPool;                      // x0, x1, z0, z1: the pool's walls
    varying vec4 vUvR;
    varying vec3 vWorld;

    // height of the water surface: gentle wind + expanding rings
    float waves(vec2 p) {
      float h = 0.0;
      h += sin(dot(p, vec2(1.3, 0.7)) * 3.1 + uTime * 1.1) * 0.0040;
      h += sin(dot(p, vec2(-0.6, 1.4)) * 4.7 + uTime * 1.6) * 0.0025;
      h += sin(dot(p, vec2(0.9, -1.1)) * 9.3 + uTime * 2.3) * 0.0012;
      // ripple RINGS, and their reflections off the four walls: each wall's
      // mirror image of the splash sends the bounced ring back across the pool
      for (int i = 0; i < MAX_RIPPLES; i++) {
        vec4 r = uRipples[i];
        float age = uTime - r.z;
        if (age < 0.0 || age > 7.0) continue;
        float front = age * 1.6;                       // ring speed, m/s
        float fade = exp(-age * 0.45) * r.w;
        vec2 c = r.xy;
        vec2 mx = vec2(2.0 * uPool.x - c.x, 2.0 * uPool.y - c.x);   // mirrored across x0 / x1
        vec2 mz = vec2(2.0 * uPool.z - c.y, 2.0 * uPool.w - c.y);   // mirrored across z0 / z1
        for (int k = 0; k < 9; k++) {
          vec2 src; float amp;
          if (k == 0) { src = c; amp = 1.0; }
          else if (k == 1) { src = vec2(mx.x, c.y); amp = 0.7; }
          else if (k == 2) { src = vec2(mx.y, c.y); amp = 0.7; }
          else if (k == 3) { src = vec2(c.x, mz.x); amp = 0.7; }
          else if (k == 4) { src = vec2(c.x, mz.y); amp = 0.7; }
          else if (k == 5) { src = vec2(mx.x, mz.x); amp = 0.5; }
          else if (k == 6) { src = vec2(mx.y, mz.x); amp = 0.5; }
          else if (k == 7) { src = vec2(mx.x, mz.y); amp = 0.5; }
          else { src = vec2(mx.y, mz.y); amp = 0.5; }
          float d = distance(p, src);
          float env = exp(-abs(d - front) * 4.0) * fade * amp;
          h += sin((d - front) * 16.0) * 0.02 * env;
        }
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
      vec2 ruv = vUvR.xy / vUvR.w + N.xz * 0.12;
      vec3 refl = texture2D(tDiffuse, ruv).rgb;

      // the bottom, seen through ~15 cm of water: refracted, darkened, mossy
      vec2 buv = (p - N.xz * 0.08) * uBottomScale;
      vec3 bottom = texture2D(uBottom, buv).rgb;
      bottom = bottom * bottom;                         // the paving map is sRGB: rough linearise
      bottom *= vec3(0.16, 0.20, 0.18);                 // light lost in the water, a green-grey tint

      float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);   // Fresnel (water)
      vec3 col = mix(bottom, refl * 1.1, clamp(F * 1.3 + 0.2, 0.0, 1.0));
      // ripples catch the low sun: a glint off the slopes toward the panorama's
      // sun (dead ahead, ~9 deg up), and disturbed water brightens a little —
      // so rings read even at this grazing angle
      vec3 sunDir = normalize(vec3(0.0, 0.165, -0.986));
      float slope = length(vec2(hx, hz)) / (2.0 * e);
      float rough = clamp((slope - 0.05) * 4.0, 0.0, 1.0);          // ~0 on calm water, 1 on a ring's flank
      float glint = pow(max(dot(reflect(-V, N), sunDir), 0.0), 160.0) * rough;
      col += vec3(1.0, 0.62, 0.32) * (1.4 * glint + 0.16 * rough * rough);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/**
 * @param {THREE.Scene} scene
 * @param {{ bottomMap: THREE.Texture, layer?: number, resolution?: number }} opts
 */
/* THE FOUNTAIN IS THE POOL (owner, 2026-10-07: "lose the old pool, just use the fountain and put the
   pool water in it"): no curb, no water of its own until fitInto(pivot, …) puts the mirror inside the
   fountain's basin — a child of the fountain's pivot, so it follows the editor (his fountain is sunk
   0.49 m and doubled). POOL (x0..z1, y) is then kept up to date with where the water really is, so the
   arrows that fall in it still find it. */
export function createPool(scene, { bottomMap, layer = 0, resolution = 0.5, cheap = false } = {}) {
  const root = new THREE.Group();
  root.name = "pool";
  scene.add(root);
  let water = null, U = null, next = 0, frame = 0, rippleMap = null;
  const box = new THREE.Box3();
  /** fill a basin: hx / hz = the water's half size, y = its height, corner = the rounded corners' radius (pivot units) */
  function fitInto(pivot, { hx, hz, y, corner = 0 }) {
    const sh = new THREE.Shape(), r = Math.min(corner, hx, hz);
    sh.moveTo(-hx + r, -hz); sh.lineTo(hx - r, -hz); sh.quadraticCurveTo(hx, -hz, hx, -hz + r);
    sh.lineTo(hx, hz - r); sh.quadraticCurveTo(hx, hz, hx - r, hz); sh.lineTo(-hx + r, hz);
    sh.quadraticCurveTo(-hx, hz, -hx, hz - r); sh.lineTo(-hx, -hz + r); sh.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
    const geo = new THREE.ShapeGeometry(sh, 6);
    if (cheap) {   // PHONES / LOW: a dark polished surface lit by the sky — no mirror — with RIPPLES (10-08: "water on the phone is flat"):
      // a small tiling ripple NORMAL map, drawn once, drifting two ways (update) so the sky light shivers across it
      const N = 128, px = new Uint8Array(N * N * 4);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const u = (x / N) * Math.PI * 2, v = (y / N) * Math.PI * 2;
        const dx = 0.5 * Math.cos(u * 3 + v) + 0.3 * Math.cos(u * 5 - v * 2) + 0.2 * Math.cos(u * 7 + v * 4);
        const dy = 0.5 * Math.cos(v * 3 - u) + 0.3 * Math.cos(v * 4 + u * 3) + 0.2 * Math.cos(v * 6 - u * 5);
        const k = (y * N + x) * 4; px[k] = 128 + dx * 60; px[k + 1] = 128 + dy * 60; px[k + 2] = 255; px[k + 3] = 255;
      }
      rippleMap = new THREE.DataTexture(px, N, N); rippleMap.wrapS = rippleMap.wrapT = THREE.RepeatWrapping; rippleMap.repeat.set(3, 3); rippleMap.needsUpdate = true;
      water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x0c1a1c, metalness: 0.85, roughness: 0.12, envMapIntensity: 1.3,
        normalMap: rippleMap, normalScale: new THREE.Vector2(0.35, 0.35) }));
    } else {
      const dpr = window.devicePixelRatio || 1;
      water = new Reflector(geo, {
        shader: WaterShader,
        textureWidth: Math.round(window.innerWidth * dpr * resolution),
        textureHeight: Math.round(window.innerHeight * dpr * resolution),
        clipBias: 0.003,
      });
      water.layers.set(layer);
      // a slower REFLECTION (owner, 2026-10-08: "reduce the temporal rate of reflection"): the mirror re-renders the whole
      // scene; doing it every 3rd frame (the last one is kept between) costs a third, and slow water hides the lag
      { const draw = water.onBeforeRender; let n = 0; water.onBeforeRender = function (...a) { if (n++ % 3 === 0) draw.apply(this, a); }; }
      water.camera.layers.enableAll();          // the mirror sees everything, fire included
      U = water.material.uniforms;
      U.uBottom.value = bottomMap;
    }
    water.name = "fountain-water";
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, y, 0);
    pivot.add(water);
    track();
  }
  function track() {   // where the water really is now (the editor may have moved the fountain)
    if (!water) return;
    water.updateWorldMatrix(true, false); box.setFromObject(water);
    POOL.x0 = box.min.x; POOL.x1 = box.max.x; POOL.z0 = box.min.z; POOL.z1 = box.max.z; POOL.y = box.max.y;
  }
  return {
    root,
    get water() { return water; },
    fitInto,
    /** a ring spreading from (x, z); strength 0..1 */
    addRipple(x, z, strength = 1) {
      if (U) U.uRipples.value[next++ % MAX_RIPPLES].set(x, z, U.uTime.value, strength);
    },
    update(t) { if (U) U.uTime.value = t; if (rippleMap) rippleMap.offset.set(t * 0.013, t * 0.008); if (++frame % 60 === 0) track(); },
  };
}
