/* sea.js — the SEA in round 4's cove (owner, 2026-10-06: "get some wave up in that water
   and have the head ripple it").

   A subdivided plane with a shader of its own (no Reflector: the pool's mirror would mean
   rendering the whole cove twice). The VERTEX shader rolls three swells across it (height
   and slope, so the lighting follows the waves). The FRAGMENT shader: deep water that turns
   to sky toward the horizon (Fresnel), the moon's glint on the slopes, pale crests, and up
   to 8 RIPPLE RINGS — same idea as the pool's — from things breaking the surface.
     createSea(scene, { x, z, width, depth, y }) -> { mesh, level, update(t), addRipple(x, z, strength), heightAt(x, z) } */
import * as THREE from "three";

const MAX_RIPPLES = 8;
// the swells: direction (x, z), wavelength (m), amplitude (m), speed (m/s)
const SWELL = [
  { dx: 0.0, dz: -1.0, len: 11, amp: 0.22, speed: 2.2 },
  { dx: 0.6, dz: -0.8, len: 6.5, amp: 0.11, speed: 1.7 },
  { dx: -0.8, dz: -0.6, len: 3.2, amp: 0.05, speed: 1.1 },
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
    uDeep: { value: new THREE.Color(0x081a22) },
    uShallow: { value: new THREE.Color(0x123a44) },
    uSky: { value: new THREE.Color(0x2e2a52) },        // the dusk sky it reflects toward the horizon (dark: it is night)
    uHorizon: { value: new THREE.Color(0x8a4a48) },    // the band of afterglow at the far edge
    uMoonDir: { value: new THREE.Vector3(-0.3, 0.55, 0.78).normalize() },
    uSwell: { value: SWELL.map((s) => new THREE.Vector4(s.dx, s.dz, s.len, s.amp)) },
    uSwellSpeed: { value: new THREE.Vector3(...SWELL.map((s) => s.speed)) },
    // the DROPS atlas (tools/make-water-tile.py): rain-ring height frames that loop in x, y and time
    uDrops: { value: null },
    uDropsLayout: { value: new THREE.Vector4(8, 4, 32, 0) },   // cols, rows, frames, (unused)
    uDropsAmp: { value: 0.09 },      // metres of displacement at the map's peak
    uDropsTile: { value: 9.0 },      // metres per tile
    uDropsLoop: { value: 7.0 },      // seconds per loop in T
    uDropsInvert: { value: 1.0 },    // 1 = the rings stand up as peaks (owner: "like choppy waves")
  };
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
      return mix(h, abs(h) * 1.5 - 0.35, uDropsInvert);
    }
    // two layers drifting across each other: the chop at a world point
    float chopAt(vec2 xz, float t) {
      float a = dropHeight(xz / uDropsTile + vec2(t * 0.012, -t * 0.02), t / uDropsLoop);
      float b = dropHeight(xz / (uDropsTile * 1.7) + vec2(-t * 0.015, t * 0.008), t / (uDropsLoop * 1.3) + 0.37);
      return (a + 0.6 * b) * uDropsAmp;
    }`;
  const vert = /* glsl */ `
    uniform float uTime;
    #ifdef HAS_DROPS
    ${dropsGlsl}
    #endif
    uniform vec4 uSwell[3];
    uniform vec3 uSwellSpeed;
    uniform vec4 uRipples[${MAX_RIPPLES}];
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vCrest;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
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
        if (age < 0.0 || age > 6.0) continue;
        vec2 dd = wp.xz - r.xy; float dist = length(dd);
        float front = age * 2.6;
        float w = exp(-pow((dist - front) / 1.1, 2.0)) * r.w * 0.16 * exp(-age * 0.45);
        float ph = (dist - front) * 4.0;
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
      wp.y += h;
      vWorld = wp.xyz;
      vNormal = normalize(vec3(-dhx, 1.0, -dhz));
      vCrest = crest / 3.0;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const frag = /* glsl */ `
    uniform float uTime;
    #ifdef HAS_DROPS
    ${dropsGlsl}
    #endif
    uniform vec3 uDeep, uShallow, uSky, uHorizon, uMoonDir;
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vCrest;
    void main() {
      vec3 n = normalize(vNormal);
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
      vec3 col = mix(water, sky, 0.06 + 0.55 * fres);
      // the moon's glint, sharp on the slopes that face it
      vec3 hv = normalize(uMoonDir + v);
      float spec = pow(max(dot(n, hv), 0.0), 180.0) * 1.6 + pow(max(dot(n, hv), 0.0), 24.0) * 0.12;
      col += vec3(0.85, 0.9, 1.0) * spec;
      // pale crests
      col += vec3(0.05, 0.06, 0.07) * smoothstep(0.86, 0.99, vCrest);   // a faint pale line on the very crests
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
  return {
    mesh, level: y,
    update(t) { U.uTime.value = t; },
    addRipple(px, pz, strength = 1) { U.uRipples.value[next++ % MAX_RIPPLES].set(px, pz, U.uTime.value, strength); },
    /** the swell's height at a point (no ripples): for things that should bob */
    heightAt(px, pz) {
      let h = 0; const t = U.uTime.value;
      for (const s of SWELL) { const l = Math.hypot(s.dx, s.dz), k = Math.PI * 2 / s.len; h += s.amp * Math.sin((s.dx / l * px + s.dz / l * pz) * k - t * s.speed * k); }
      return y + h;
    },
  };
}
