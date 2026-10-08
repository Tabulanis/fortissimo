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
// the swells: direction (x, z), wavelength (m), amplitude (m), speed (m/s). OCEAN SHAPE (owner, 2026-10-07,
// his photo: "THERE" — rolling swells, peaked crests, chop riding them; "chipped obsidian" = that SHAPE):
// five waves fanned around the wind, each PEAKED (Gerstner: the water slides toward the crest, so crests
// pinch sharp and troughs go broad). Amplitudes sum under the dock deck's 0.7 m clearance.
const SWELL = [
  { dx: 0.0, dz: -1.0, len: 9.0, amp: 0.30, speed: 2.2 },
  { dx: 0.45, dz: -0.9, len: 5.6, amp: 0.17, speed: 1.75 },
  { dx: -0.5, dz: -0.86, len: 3.5, amp: 0.10, speed: 1.4 },
  { dx: 0.8, dz: -0.6, len: 2.2, amp: 0.055, speed: 1.1 },
  { dx: -0.25, dz: -0.97, len: 1.4, amp: 0.03, speed: 0.9 },
];
const NSWELL = SWELL.length, STEEP = 0.8;   // STEEP: how hard the crests pinch (0 = plain sines, 1 = just short of looping over)

/** a plane grid in xz whose spacing grows with distance from (fx, fz): spacing = fine * (1 + d / falloff), capped at coarse */
function gradedGrid({ x0, x1, z0, z1, fx, fz, fine, coarse, falloff }) {
  // (10-08: past 40 m the spacing grows fast — the open sea runs out to the draw distance on about the same budget)
  const step = (d) => Math.min(d > 40 ? 12 : coarse, fine * (1 + d / falloff) * (1 + Math.max(0, d - 40) / 12));
  const axis = (a0, a1, f) => { const out = [a0]; let a = a0; while (a < a1) { a += step(Math.abs(a - f)); out.push(Math.min(a, a1)); } return out; };
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
    uDeep: { value: new THREE.Color(0x0f1e2b) },      // deep slate (10-07: off pure black so the shapes read; "deeper": no shallow tint near the gate)
    uShallow: { value: new THREE.Color(0x162a3a) },
    uSunDir: { value: new THREE.Vector3(0.1, 0.18, 1.0).normalize() },   // the afterglow low over the sea: warm light on the crests (his photo)
    uFacet: { value: 0.3 },          // 0 smooth skin .. 1 hard flat shards (10-07: broad chipped faces, not tiny shards)
    uSky: { value: new THREE.Color(0x2e2a52) },        // the dusk sky it reflects toward the horizon (dark: it is night)
    uHorizon: { value: new THREE.Color(0x8a4a48) },    // the band of afterglow at the far edge
    uMoonDir: { value: new THREE.Vector3(-0.3, 0.55, 0.78).normalize() },
    uSwell: { value: SWELL.map((s) => new THREE.Vector4(s.dx, s.dz, s.len, s.amp)) },
    uSwellSpeed: { value: SWELL.map((s) => s.speed) },
    // THE CHOP (owner, 2026-10-07: "instead of the rain ripples let's do more chop"): eight short PEAKED waves
    // fanned around the wind, riding the swells and bunching on their crests (no texture any more)
    uChopAmp: { value: 1.0 },        // overall strength of the ridged chop
    // the CLOTH (wavesim.js): simulated heights over a patch around the focus, as a float texture
    uSim: { value: null },
    uSimRect: { value: new THREE.Vector4(0, 0, 1, 1) },   // x0, z0, size, cells
  };
  const sim = new WaveSim({ x0: focus.x - 24, z0: focus.z - 20, size: 48, n: 160 });
  U.uSim.value = sim.texture; U.uSimRect.value.set(sim.x0, sim.z0, sim.size, sim.n);
  const chopGlsl = /* glsl */ `
    uniform float uChopAmp;
    // the main swell's crest factor at a point (0 trough .. 1 crest): the chop COALESCES onto it
    float crestAt(vec2 xz, float t) {
      vec2 d = normalize(uSwell[0].xy); float k = 6.2831853 / uSwell[0].z;
      float c0 = 0.5 + 0.5 * sin(dot(d, xz) * k - t * uSwellSpeed[0] * k);
      vec2 d1 = normalize(uSwell[1].xy); float k1 = 6.2831853 / uSwell[1].z;
      float c1 = 0.5 + 0.5 * sin(dot(d1, xz) * k1 - t * uSwellSpeed[1] * k1);
      return 0.65 * c0 + 0.35 * c1;
    }
    // THE CHOP (owner 10-07: "look at what people do for oceans — Sea of Thieves… steal from those guys"): the
    // technique most game oceans use for the small waves — layered RIDGED octaves. Each octave is two crossing
    // wave trains warped by noise (no straight lines), folded with 1-|sin| so the tops are sharp ridges and the
    // hollows round; each next octave is turned, ~1.9x finer and ~0.42x lower. Written fresh for this game (the
    // famous Shadertoy "Seascape" is non-commercial licensed — the idea is free, its code is not).
    float chopHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
    float chopNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
      return mix(mix(chopHash(i), chopHash(i + vec2(1.0, 0.0)), u.x), mix(chopHash(i + vec2(0.0, 1.0)), chopHash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float chopOctave(vec2 p) {
      p += (vec2(chopNoise(p * 0.5), chopNoise(p * 0.5 + 7.3)) - 0.5) * 2.2;   // warp
      float rx = 1.0 - abs(sin(p.x)), rz = 1.0 - abs(sin(p.y));
      return rx * rz;                                                       // sharp chips where both ridges meet
    }
    float chopOct(vec2 xz, float t, int octaves) {
      vec2 p = xz * (3.1415927 / 1.7);          // the biggest chop: 1.7 m between ridges
      float amp = 0.12, h = 0.0;
      mat2 R = mat2(0.8, 0.6, -0.6, 0.8);       // each octave turned ~37°
      for (int i = 0; i < 4; i++) {
        if (i >= octaves) break;
        h += amp * (chopOctave(p + vec2(0.31 * float(i), t * (1.3 + 0.35 * float(i)))) - 0.3);   // travelling toward the shore
        p = R * p * 1.9; amp *= 0.42;
      }
      float c = crestAt(xz, t);
      return h * uChopAmp * (0.35 + 1.1 * c * c);   // builds on the crests, dies in the troughs
    }
    float chopAt(vec2 xz, float t) { return chopOct(xz, t, 4); }`;
  // (10-08 DIAGNOSIS: his phone fails to LINK this shader — NO_SIM / NO_VCHOP / NO_FCHOP / NO_RIPPLES switch the suspects off, ?seatest)
  const simGlsl = /* glsl */ `
    #ifdef NO_SIM
    float simAt(vec2 xz) { return 0.0; }
    #else
    uniform sampler2D uSim;
    uniform vec4 uSimRect;
    // the cloth's height at a world point, fading to 0 over the patch's outer 3 m
    float simAt(vec2 xz) {
      vec2 uv = (xz - uSimRect.xy) / uSimRect.z;
      if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return 0.0;
      vec2 e = min(uv, 1.0 - uv) * uSimRect.z / 3.0;
      float fade = clamp(min(e.x, e.y), 0.0, 1.0);
      return texture2D(uSim, uv).r * fade;
    }
    #endif`;
  const vert = /* glsl */ `
    uniform float uTime;
    uniform vec4 uSwell[${NSWELL}];        // declared BEFORE the shared chop code: crestAt() uses them
    uniform float uSwellSpeed[${NSWELL}];
    ${simGlsl}
    ${chopGlsl}
    uniform vec4 uRipples[${MAX_RIPPLES}];
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vCrest;
    varying float vTorn;
    varying float vHeight, vPinch;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vTorn = 0.0;
      float calm = 1.0 - smoothstep(45.0, 140.0, length(wp.xz - cameraPosition.xz));   // far water: gentle (and no jitter on the big far triangles)
      float h = 0.0; float dhx = 0.0; float dhz = 0.0; float crest = 0.0;
      vec2 slide = vec2(0.0); float pinch = 0.0;
      for (int i = 0; i < ${NSWELL}; i++) {   // GERSTNER: height + the slide toward the crest (peaked crests, broad troughs)
        vec2 d = normalize(uSwell[i].xy);
        float k = 6.2831853 / uSwell[i].z;
        float ph = dot(d, wp.xz) * k - uTime * uSwellSpeed[i] * k;
        float a = uSwell[i].w, q = ${STEEP.toFixed(2)} / (k * a * ${NSWELL}.0);
        h += a * sin(ph);
        slide += q * a * d * cos(ph);
        dhx += a * k * d.x * cos(ph); dhz += a * k * d.y * cos(ph);
        pinch += q * a * k * sin(ph);
        crest += (0.5 + 0.5 * sin(ph)) * a;
      }
      wp.xz += slide * calm;   // a point just before the crest (cos > 0) moves forward, just past it back: both bunch at the crest
      dhx /= max(0.25, 1.0 - pinch); dhz /= max(0.25, 1.0 - pinch);   // the pinched crests are steeper
      // ripple rings: a damped circular wave from each ring's centre
      #ifndef NO_RIPPLES
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
      #endif
      // (the chop: always on now)
      {
        // (10-08: HIS PHONE failed to LINK this shader — 12 noise octaves per vertex was too much for its chip. The vertex
        // now takes the chop's HEIGHT only, 2 octaves; its slope and the fine octaves are per pixel in the fragment anyway)
        #ifndef NO_VCHOP
        h += chopOct(wp.xz, uTime, 2);
        #endif
      }
      {   // the cloth: the simulated waves around the podium and the hydra
        float e = 0.3;
        float s0 = simAt(wp.xz), sx = simAt(wp.xz + vec2(e, 0.0)), sz = simAt(wp.xz + vec2(0.0, e));
        h += s0; dhx += (sx - s0) / e; dhz += (sz - s0) / e;
        vTorn = min(1.5, abs(s0) * 2.5 + length(vec2(sx - s0, sz - s0)) / e * 1.2);   // the cloth's own disturbance feeds the foam
      }
      h *= calm; dhx *= calm; dhz *= calm;
      wp.y += h;
      vHeight = h; vPinch = pinch;
      vWorld = wp.xyz;
      vNormal = normalize(vec3(-dhx, 1.0, -dhz));
      vCrest = crest / ${SWELL.reduce((t, s) => t + s.amp, 0).toFixed(3)};
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const frag = /* glsl */ `
    uniform float uTime;
    uniform vec4 uSwell[${NSWELL}];
    uniform float uSwellSpeed[${NSWELL}];   // crestAt() in the drops GLSL needs both here too
    varying float vTorn;
    varying float vHeight, vPinch;
    float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float foamNoise(vec2 p) {   // value noise, 2 octaves are added by the caller
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
    }
    ${simGlsl}
    ${chopGlsl}
    uniform vec3 uDeep, uShallow, uSky, uHorizon, uMoonDir, uSunDir;
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
      // (the chop: always on now)
      #ifndef NO_FCHOP
      {   // per-pixel chop normal (the vertex grid is too coarse for the small rings)
        float e = 0.03;
        float c0 = chopAt(vWorld.xz, uTime), cx = chopAt(vWorld.xz + vec2(e, 0.0), uTime), cz = chopAt(vWorld.xz + vec2(0.0, e), uTime);
        float near = 1.0 - smoothstep(40.0, 130.0, length(vWorld.xz - cameraPosition.xz));
        n = normalize(n + vec3(-(cx - c0) / e, 0.0, -(cz - c0) / e) * near);   // the chop's facets, per pixel (the grid is too coarse for the shortest waves)
      }
      #endif
      vec3 v = normalize(cameraPosition - vWorld);
      float far = clamp((vWorld.z - 20.0) / 70.0, 0.0, 1.0);
      // REFLECTION BY ANGLE (Schlick Fresnel, water's 2%): looking down you see INTO the water, at a glancing
      // angle it's a mirror of the sky — the reflected ray picks the sky's colour by how high it points
      float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
      vec3 r = reflect(-v, n);
      vec3 skyR = mix(uHorizon, uSky, smoothstep(-0.05, 0.4, r.y));
      // the BODY: deep slate, lit a little by how each face turns to the afterglow
      vec3 L = normalize(uSunDir);
      float face = max(dot(n, normalize(L + vec3(0.0, 0.8, 0.0))), 0.0);
      vec3 body = mix(uShallow, uDeep, clamp(far * 1.5, 0.0, 1.0)) * (0.65 + 0.55 * face);
      // SUBSURFACE (Sea of Thieves' signature): with the low light BEHIND a wave, its thin top glows teal —
      // strongest looking toward the light, on the highest water, on faces turned away from you
      float back = pow(clamp(dot(-v, L), 0.0, 1.0), 3.0);
      float tip = clamp(vHeight * 1.6 + 0.25, 0.0, 1.0);
      vec3 sss = vec3(0.12, 0.48, 0.42) * back * tip * tip * (0.5 + 0.5 * clamp(1.0 - dot(n, v), 0.0, 1.0));
      vec3 col = mix(body + sss, skyR, F);
      // the low light's glint off the slopes (warm), and the moon's (cool, small)
      vec3 hs = normalize(L + v), hv = normalize(uMoonDir + v);
      col += vec3(1.0, 0.6, 0.36) * (pow(max(dot(n, hs), 0.0), 120.0) * 0.6 + pow(max(dot(n, hs), 0.0), 1200.0) * 2.0);
      col += vec3(0.85, 0.9, 1.0) * pow(max(dot(n, hv), 0.0), 600.0) * 0.8;
      // FOAM only where a crest really PINCHES (the swells' Jacobian) or the cloth is torn up — streaked by the wind
      vec2 wind = normalize(uSwell[0].xy);
      vec2 fuv = vec2(dot(vWorld.xz, wind) * 0.35 - uTime * 0.25, dot(vWorld.xz, vec2(-wind.y, wind.x)) * 1.4);
      float fn = foamNoise(fuv) * 0.6 + foamNoise(fuv * 2.7 + 3.1) * 0.4;
      float foam = clamp(smoothstep(0.55, 0.8, vPinch) + smoothstep(0.6, 1.3, vTorn), 0.0, 1.0) * smoothstep(0.4, 0.75, fn);
      col = mix(col, vec3(0.75, 0.8, 0.82), foam * 0.6);
      // the far edge melts into the open sea painted on the sky dome (stage3d) — no line where the water ends
      gl_FragColor = vec4(col, 1.0 - smoothstep(150.0, 205.0, length(vWorld.xz - cameraPosition.xz)));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  // TESSELLATION (owner, 2026-10-07: "the water needs tessellation, otherwise the waves are useless"):
  // no hardware tessellation in WebGL, so the grid itself is GRADED — a vertex every `fine` metres
  // around the focus (the podium / the hydra) growing to `coarse` at the far edges. The same vertex
  // budget as a uniform grid, spent where it is seen; the swell and the chop become real geometry.
  const geo = gradedGrid({ x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2, fx: focus.x - x, fz: focus.z - z, fine, coarse, falloff });
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vert, fragmentShader: frag, transparent: true });   // (its far edge fades)
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
      for (const s of SWELL) { const l = Math.hypot(s.dx, s.dz), k = Math.PI * 2 / s.len; h += s.amp * Math.sin((s.dx / l * px + s.dz / l * pz) * k - t * s.speed * k); }   // (the crest slide is left out: a few cm)
      return y + h + sim.heightAt(px, pz);
    },
  };
  return api;
}
