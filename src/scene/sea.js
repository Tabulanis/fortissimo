/* sea.js — the SEA in round 4's cove (owner, 2026-10-06: "get some wave up in that water
   and have the head ripple it").

   A subdivided plane with a shader of its own (no Reflector: the pool's mirror would mean
   rendering the whole cove twice). The VERTEX shader rolls three swells across it (height
   and slope, so the lighting follows the waves). The FRAGMENT shader: deep water that turns
   to sky toward the horizon (Fresnel), the moon's glint on the slopes, pale crests, and up
   to 8 RIPPLE RINGS — same idea as the pool's — from things breaking the surface.
     createSea(scene, { x, z, width, depth, y }) -> { mesh, level, update(t), addRipple(x, z, strength), heightAt(x, z) } */
import * as THREE from "three";
import { WaveSim } from "./wavesim.js";

const MAX_RIPPLES = 8;
// the swells: direction (x, z), wavelength (m), amplitude (m), speed (m/s)
const SWELL = [
  { dx: 0.0, dz: -1.0, len: 11, amp: 0.42, speed: 2.4 },   // (owner 10-07: "a lot more chop — practically flat"; trimmed so it stays under the dock deck)
  { dx: 0.6, dz: -0.8, len: 6.5, amp: 0.24, speed: 1.9 },
  { dx: -0.8, dz: -0.6, len: 3.2, amp: 0.13, speed: 1.3 },
];

/** a plane grid in xz whose spacing grows with distance from (fx, fz): spacing = fine * (1 + d / falloff), capped at coarse */
function gradedGrid({ x0, x1, z0, z1, fx, fz, fine, coarse, falloff }) {
  const axis = (a0, a1, f) => { const out = [a0]; let a = a0; while (a < a1) { a += Math.min(coarse, fine * (1 + Math.abs(a - f) / falloff)); out.push(Math.min(a, a1)); } return out; };
  const xs = axis(x0, x1, fx), zs = axis(z0, z1, fz);
  const nx = xs.length, nz = zs.length, pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; pos[k * 3] = xs[i]; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = zs[j];
    uv[k * 2] = (xs[i] - x0) / (x1 - x0); uv[k * 2 + 1] = (zs[j] - z0) / (z1 - z0);
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let n = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + nx;
    idx[n++] = a; idx[n++] = b; idx[n++] = a + 1; idx[n++] = b; idx[n++] = b + 1; idx[n++] = a + 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.userData.verts = nx * nz;
  return g;
}

export function createSea(scene, { x = 0, z = 60, width = 110, depth = 110, y = -0.15, focus = new THREE.Vector3(0, 0, 32), fine = 0.12, coarse = 3.0, falloff = 9 } = {}) {
  const U = {
    uTime: { value: 0 },
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uDeep: { value: new THREE.Color(0x04080c) },      // obsidian (owner: "chips of obsidian that are moving")
    uShallow: { value: new THREE.Color(0x0b2229) },
    uFacet: { value: 0.75 },         // 0 smooth skin .. 1 hard flat shards
    uSky: { value: new THREE.Color(0x2e2a52) },        // the dusk sky it reflects toward the horizon (dark: it is night)
    uHorizon: { value: new THREE.Color(0x8a4a48) },    // the band of afterglow at the far edge
    uMoonDir: { value: new THREE.Vector3(-0.3, 0.55, 0.78).normalize() },
    uSwell: { value: SWELL.map((s) => new THREE.Vector4(s.dx, s.dz, s.len, s.amp)) },
    uSwellSpeed: { value: new THREE.Vector3(...SWELL.map((s) => s.speed)) },
    // the DROPS atlas (tools/make-water-tile.py): rain-ring height frames that loop in x, y and time
    uDrops: { value: null },
    uDropsLayout: { value: new THREE.Vector4(8, 4, 32, 0) },   // cols, rows, frames, (unused)
    uDropsAmp: { value: 0.32 },      // metres of displacement at the map's peak (the reverse-rain chop)
    uDropsTile: { value: 6.0 },      // metres per tile (smaller: denser chop)
    uDropsLoop: { value: 7.0 },      // seconds per loop in T
    uDropsInvert: { value: 1.0 },    // 1 = the rings stand up as peaks (owner: "like choppy waves")
    // the CLOTH (wavesim.js): simulated heights over a patch around the focus, as a float texture
    uSim: { value: null },
    uSimRect: { value: new THREE.Vector4(0, 0, 1, 1) },   // x0, z0, size, cells
  };
  const sim = new WaveSim({ x0: focus.x - 24, z0: focus.z - 20, size: 48, n: 160 });
  U.uSim.value = sim.texture; U.uSimRect.value.set(sim.x0, sim.z0, sim.size, sim.n);
  new THREE.TextureLoader().load("/textures/water-drops.png", (tex) => {
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;   // the atlas itself must not wrap — frames tile by uv maths
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    U.uDrops.value = tex; mat.defines.HAS_DROPS = 1; mat.needsUpdate = true;
  }, undefined, (e) => console.warn("water-drops.png failed to load", e));
  const dropsGlsl = /* glsl */ `
    uniform sampler2D uDrops;
    uniform vec4 uDropsLayout;
    uniform float uDropsAmp, uDropsTile, uDropsLoop, uDropsInvert;
    // one frame's texel: frame f of the atlas at tile uv (wrapping in x, y by fract)
    float dropFrame(vec2 uv, float f) {
      float cols = uDropsLayout.x, rows = uDropsLayout.y;
      vec2 cell = vec2(mod(f, cols), floor(f / cols));
      vec2 inner = fract(uv);
      // keep off the frame's outer half-texel so bilinear filtering never bleeds the neighbour frame
      inner = (inner * (1.0 - 2.0 / 256.0) + 1.0 / 256.0);
      vec2 auv = (cell + inner) / vec2(cols, rows);
      auv.y = 1.0 - auv.y;
      return texture2D(uDrops, auv).r * 2.0 - 1.0;
    }
    // height at tile uv, looping in T: blend the two frames either side of the phase
    float dropHeight(vec2 uv, float phase) {
      float frames = uDropsLayout.z;
      float fp = fract(phase) * frames;
      float f0 = floor(fp), f1 = mod(f0 + 1.0, frames);
      float h = mix(dropFrame(uv, f0), dropFrame(uv, f1), fp - f0);
      // INVERTED (owner): the rings stand up as PEAKS — sharp crests, broad hollows — choppy water
      return mix(h, abs(h) * 1.9 - 0.45, uDropsInvert);   // sharper peaks, deeper hollows
    }
    // two layers drifting across each other: the chop at a world point
    // the main swell's crest factor at a point (0 trough .. 1 crest): the chop COALESCES onto it
    float crestAt(vec2 xz, float t) {
      vec2 d = normalize(uSwell[0].xy); float k = 6.2831853 / uSwell[0].z;
      float c0 = 0.5 + 0.5 * sin(dot(d, xz) * k - t * uSwellSpeed[0] * k);
      vec2 d1 = normalize(uSwell[1].xy); float k1 = 6.2831853 / uSwell[1].z;
      float c1 = 0.5 + 0.5 * sin(dot(d1, xz) * k1 - t * uSwellSpeed[1] * k1);
      return 0.65 * c0 + 0.35 * c1;
    }
    float chopAt(vec2 xz, float t) {
      vec2 wind = normalize(uSwell[0].xy) * 0.018;   // both layers travel WITH the swell (owner: "they look all over the place")
      float a = dropHeight(xz / uDropsTile + wind * t, t / uDropsLoop);
      float b = dropHeight(xz / (uDropsTile * 1.7) + wind * t * 0.7 + vec2(0.31, 0.57), t / (uDropsLoop * 1.3) + 0.37);
      float c = crestAt(xz, t);
      return (a + 0.5 * b) * uDropsAmp * (0.25 + 0.95 * c * c);   // builds on the crests, dies in the troughs
    }`;
  const simGlsl = /* glsl */ `
    uniform sampler2D uSim;
    uniform vec4 uSimRect;
    // the cloth's height at a world point, fading to 0 over the patch's outer 3 m
    float simAt(vec2 xz) {
      vec2 uv = (xz - uSimRect.xy) / uSimRect.z;
      if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return 0.0;
      vec2 e = min(uv, 1.0 - uv) * uSimRect.z / 3.0;
      float fade = clamp(min(e.x, e.y), 0.0, 1.0);
      return texture2D(uSim, uv).r * fade;
    }`;
  const vert = /* glsl */ `
    uniform float uTime;
    uniform vec4 uSwell[3];        // declared BEFORE the shared chop code: crestAt() uses them
    uniform vec3 uSwellSpeed;
    ${simGlsl}
    #ifdef HAS_DROPS
    ${dropsGlsl}
    #endif
    uniform vec4 uRipples[${MAX_RIPPLES}];
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vCrest;
    varying float vTorn;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vTorn = 0.0;
      float h = 0.0; float dhx = 0.0; float dhz = 0.0; float crest = 0.0;
      for (int i = 0; i < 3; i++) {
        vec2 d = normalize(uSwell[i].xy);
        float k = 6.2831853 / uSwell[i].z;
        float ph = dot(d, wp.xz) * k - uTime * uSwellSpeed[i] * k;
        float a = uSwell[i].w;
        h += a * sin(ph);
        dhx += a * k * d.x * cos(ph); dhz += a * k * d.y * cos(ph);
        crest += 0.5 + 0.5 * sin(ph);
      }
      // ripple rings: a damped circular wave from each ring's centre
      for (int i = 0; i < ${MAX_RIPPLES}; i++) {
        vec4 r = uRipples[i];
        float age = uTime - r.z;
        if (age < 0.0 || age > 9.0) continue;
        vec2 dd = wp.xz - r.xy; float dist = length(dd);
        float front = age * 3.0;
        float w = exp(-pow((dist - front) / 1.6, 2.0)) * r.w * 0.42 * exp(-age * 0.35);   // the hydra's WAKES: tall, wide, long-lived
        float ph = (dist - front) * 3.2;
        h += w * cos(ph);
        vec2 g = (dd / max(dist, 0.001)) * (-w * 4.0 * sin(ph));
        dhx += g.x; dhz += g.y;
      }
      #ifdef HAS_DROPS
      {
        float e = 0.18;
        float c0 = chopAt(wp.xz, uTime), cx = chopAt(wp.xz + vec2(e, 0.0), uTime), cz = chopAt(wp.xz + vec2(0.0, e), uTime);
        h += c0; dhx += (cx - c0) / e; dhz += (cz - c0) / e;
      }
      #endif
      {   // the cloth: the simulated waves around the podium and the hydra
        float e = 0.3;
        float s0 = simAt(wp.xz), sx = simAt(wp.xz + vec2(e, 0.0)), sz = simAt(wp.xz + vec2(0.0, e));
        h += s0; dhx += (sx - s0) / e; dhz += (sz - s0) / e;
        vTorn = min(1.5, abs(s0) * 2.5 + length(vec2(sx - s0, sz - s0)) / e * 1.2);   // the cloth's own disturbance feeds the foam
      }
      wp.y += h;
      vWorld = wp.xyz;
      vNormal = normalize(vec3(-dhx, 1.0, -dhz));
      vCrest = crest / 3.0;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const frag = /* glsl */ `
    uniform float uTime;
    uniform vec4 uSwell[3];
    uniform vec3 uSwellSpeed;   // crestAt() in the drops GLSL needs both here too
    varying float vTorn;
    float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float foamNoise(vec2 p) {   // value noise, 2 octaves are added by the caller
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
    }
    ${simGlsl}
    #ifdef HAS_DROPS
    ${dropsGlsl}
    #endif
    uniform vec3 uDeep, uShallow, uSky, uHorizon, uMoonDir;
    uniform float uFacet;
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vCrest;
    void main() {
      vec3 n = normalize(vNormal);
      // OBSIDIAN CHIPS (owner, 2026-10-07): the geometric, flat normal of each triangle — hard facets —
      // blended over the smooth one, so the glints break into moving shards
      { vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld))); if (fn.y < 0.0) fn = -fn; n = normalize(mix(n, fn, uFacet)); }
      {   // per-pixel cloth normal
        float e = 0.15;
        float s0 = simAt(vWorld.xz), sx = simAt(vWorld.xz + vec2(e, 0.0)), sz = simAt(vWorld.xz + vec2(0.0, e));
        n = normalize(n + vec3(-(sx - s0) / e, 0.0, -(sz - s0) / e));
      }
      #ifdef HAS_DROPS
      {   // per-pixel chop normal (the vertex grid is too coarse for the small rings)
        float e = 0.06;
        float c0 = chopAt(vWorld.xz, uTime), cx = chopAt(vWorld.xz + vec2(e, 0.0), uTime), cz = chopAt(vWorld.xz + vec2(0.0, e), uTime);
        n = normalize(n + vec3(-(cx - c0) / e, 0.0, -(cz - c0) / e) * 1.2);
      }
      #endif
      vec3 v = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      float far = clamp((vWorld.z - 20.0) / 70.0, 0.0, 1.0);
      vec3 water = mix(uShallow, uDeep, clamp(far * 1.5, 0.0, 1.0));
      vec3 sky = mix(uSky, uHorizon, far * far);
      vec3 col = mix(water, sky, 0.05 + 0.42 * fres);   // (the steep chop faces went icy-white at 0.55)
      // the moon's glint, sharp on the slopes that face it
      vec3 hv = normalize(uMoonDir + v);
      float spec = pow(max(dot(n, hv), 0.0), 420.0) * 2.2 + pow(max(dot(n, hv), 0.0), 40.0) * 0.1;   // glass-hard glints
      col += vec3(0.85, 0.9, 1.0) * spec;
      // FOAM (owner, 2026-10-07: "generate foam as a texture wherever it's really chopped up"):
      // how torn-up the surface is here = slope of the final normal + the crest factor + the cloth's motion;
      // past a threshold, a streaky hash-noise foam (stretched along the wind) is laid over the water
      float torn = (1.0 - n.y) * 6.0 + smoothstep(0.7, 1.0, vCrest) * 0.6 + vTorn;
      vec2 wind = normalize(uSwell[0].xy);
      vec2 fuv = vec2(dot(vWorld.xz, wind) * 0.35 - uTime * 0.25, dot(vWorld.xz, vec2(-wind.y, wind.x)) * 1.4);   // long along the wind
      float fn = foamNoise(fuv) * 0.6 + foamNoise(fuv * 2.7 + 3.1) * 0.4;
      float foam = smoothstep(0.55, 1.25, torn) * smoothstep(0.35, 0.75, fn);
      col = mix(col, vec3(0.88, 0.92, 0.95), foam * 0.85);
      col += vec3(0.05, 0.06, 0.07) * smoothstep(0.86, 0.99, vCrest) * (1.0 - foam);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  // TESSELLATION (owner, 2026-10-07: "the water needs tessellation, otherwise the waves are useless"):
  // no hardware tessellation in WebGL, so the grid itself is GRADED — a vertex every `fine` metres
  // around the focus (the podium / the hydra) growing to `coarse` at the far edges. The same vertex
  // budget as a uniform grid, spent where it is seen; the swell and the chop become real geometry.
  const geo = gradedGrid({ x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2, fx: focus.x - x, fz: focus.z - z, fine, coarse, falloff });
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vert, fragmentShader: frag });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = "sea"; mesh.position.set(x, y, z); mesh.frustumCulled = false;
  scene.add(mesh);
  console.log(`sea: graded grid, ${geo.userData.verts} vertices`);
  let next = 0;
  let lastT = 0;
  // SPRAY (owner, 2026-10-07: "a particle simulation when the angle's high enough"): each frame
  // the cloth is scanned (every 3rd cell) for steep, fast-moving spots — a crest breaking, a neck
  // tearing through — and droplets are thrown there through onSpray(x, y, z, power, dir)
  const SPRAY_SLOPE = 0.5, SPRAY_SPEED = 0.9, SPRAY_MAX = 24;
  function scanSpray(api) {
    if (!api.onSpray) return;
    const n = sim.n, h = sim.h, v = sim.v, dx = sim.dx; let thrown = 0;
    for (let j = 2; j < n - 2 && thrown < SPRAY_MAX; j += 3) for (let i = 2; i < n - 2 && thrown < SPRAY_MAX; i += 3) {
      const p = j * n + i, gx = (h[p + 1] - h[p - 1]) / (2 * dx), gz = (h[p + n] - h[p - n]) / (2 * dx);
      const slope = Math.hypot(gx, gz), up = v[p];
      if (slope > SPRAY_SLOPE && up > SPRAY_SPEED && Math.random() < 0.35) {
        const power = Math.min(1, (slope - SPRAY_SLOPE) * 0.8 + (up - SPRAY_SPEED) * 0.3);
        api.onSpray(sim.x0 + i * dx, y + h[p], sim.z0 + j * dx, power, { x: -gx / (slope + 1e-6), z: -gz / (slope + 1e-6) });
        thrown++;
      }
    }
  }
  const api = {
    mesh, level: y, sim, onSpray: null,
    update(t) { const dt = lastT ? Math.min(0.1, t - lastT) : 0.016; lastT = t; U.uTime.value = t; sim.step(dt); scanSpray(api); },
    /** something breaks the surface: press the cloth there (inside the patch), else the far-water ring */
    addRipple(px, pz, strength = 1) {
      if (!sim.press(px, pz, strength * 0.12, 0.7 + strength * 0.35)) U.uRipples.value[next++ % MAX_RIPPLES].set(px, pz, U.uTime.value, strength);
    },
    press: (px, pz, amount, radius) => sim.press(px, pz, amount, radius),
    /** the swell's height at a point (no ripples): for things that should bob */
    heightAt(px, pz) {
      let h = 0; const t = U.uTime.value;
      for (const s of SWELL) { const l = Math.hypot(s.dx, s.dz), k = Math.PI * 2 / s.len; h += s.amp * Math.sin((s.dx / l * px + s.dz / l * pz) * k - t * s.speed * k); }
      return y + h + sim.heightAt(px, pz);
    },
  };
  return api;
}
