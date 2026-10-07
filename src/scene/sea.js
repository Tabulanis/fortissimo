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

export function createSea(scene, { x = 0, z = 60, width = 110, depth = 110, y = -0.15, segments = 140 } = {}) {
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
  };
  const vert = /* glsl */ `
    uniform float uTime;
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
      wp.y += h;
      vWorld = wp.xyz;
      vNormal = normalize(vec3(-dhx, 1.0, -dhz));
      vCrest = crest / 3.0;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const frag = /* glsl */ `
    uniform vec3 uDeep, uShallow, uSky, uHorizon, uMoonDir;
    varying vec3 vWorld;
    varying vec3 vNormal;
    varying float vCrest;
    void main() {
      vec3 n = normalize(vNormal);
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
  const geo = new THREE.PlaneGeometry(width, depth, segments, Math.round(segments * depth / width));
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vert, fragmentShader: frag });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = "sea"; mesh.position.set(x, y, z); mesh.frustumCulled = false;
  scene.add(mesh);
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
