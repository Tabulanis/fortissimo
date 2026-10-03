/* defense.js — what you BUILD by playing (owner, 2026-10-03):
 *
 *   THE SHIELD  a fresnel-blue dome round the player in three parts, one per
 *               section: FRONT = the drums, RIGHT = the bass, LEFT = the treble.
 *               A part shimmers faintly while it's being built (its progress)
 *               and stands solid once its section is done; a missed arrow that
 *               reaches a part that's up flashes it where it struck.
 *   CANNONS     every top-row note (yours, or the band's ghosts) launches a
 *               glowing bolt from its bar at that bar's archer on the roofs,
 *               bursting where it lands.
 *
 * createDefense(scene, { fireTexture, layer }) -> { setShield, shieldHit, fire, update } */
import * as THREE from "three";

const R = 3.4;                       // dome radius (m): round the player and both stations
const CENTER = new THREE.Vector3(0, 0, 0.3);
// sectors round the vertical axis (SphereGeometry phi: x = -cos(phi), z = sin(phi));
// front (-z) = 3pi/2; the other two a third of the way round each side
const SECTORS = { drums: 3 * Math.PI / 2, bass: 5 * Math.PI / 6, treble: Math.PI / 6 };
const BOLT_S = 0.55;                 // a bolt's flight time
const BOLTS = 16, BURSTS = 16;

const VERT = `varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vP;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vUv = uv; vP = position; vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`;
// an ENERGY LATTICE: bright grid lines on a nearly clear skin, a seam glowing
// along the ground, a pulse sweeping up — reads as a dome, keeps the view clear
const FRAG = `uniform vec3 uColor; uniform float uStrength, uTime, uHit; uniform vec3 uHitAt;
varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vP;
float line(float x, float w) { float f = abs(fract(x) - 0.5); return smoothstep(0.5 - w, 0.5, f); }
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 3.0);
  float grid = max(line(vUv.x * 14.0, 0.03), line(vUv.y * 6.0, 0.04));          // the lattice
  float seam = smoothstep(0.08, 0.0, vUv.y);                                      // where it meets the ground
  float sweep = smoothstep(0.12, 0.0, abs(fract(vUv.y - uTime * 0.25) - 0.5) - 0.38);   // a pulse running up
  float hit = uHit * smoothstep(1.6, 0.0, distance(vP, uHitAt));
  float a = uStrength * (0.015 + 0.55 * grid + 0.25 * rim + 0.7 * seam + 0.25 * sweep * grid) + hit * (0.5 + 0.8 * grid);
  gl_FragColor = vec4(uColor * (0.9 + 0.8 * grid + hit), a);
}`;

export function createDefense(scene, { fireTexture, layer = 0 } = {}) {
  const group = new THREE.Group();
  group.position.copy(CENTER);
  scene.add(group);

  // ---- the shield: three sector meshes -------------------------------------
  const parts = {};
  for (const [name, mid] of Object.entries(SECTORS)) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x58c8ff) }, uStrength: { value: 0 }, uTime: { value: 0 }, uHit: { value: 0 }, uHitAt: { value: new THREE.Vector3() } },
    });
    const geo = new THREE.SphereGeometry(R, 48, 16, mid - Math.PI / 3, (2 * Math.PI) / 3, 0, Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.layers.set(layer);
    mesh.visible = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    parts[name] = { mesh, mat, target: 0, value: 0, up: false, hit: 0 };
  }

  // ---- cannon bolts + bursts (pools, nothing allocated per shot) -------------
  const spriteMat = () => new THREE.SpriteMaterial({ map: fireTexture, color: 0x9fe6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const TRAIL = 5;   // fading glows behind each bolt: it reads as a streak at any distance
  const bolts = Array.from({ length: BOLTS }, () => {
    const s = new THREE.Sprite(spriteMat()); s.visible = false; s.layers.set(layer); scene.add(s);
    const trail = Array.from({ length: TRAIL }, () => { const t = new THREE.Sprite(spriteMat()); t.visible = false; t.layers.set(layer); scene.add(t); return t; });
    return { s, trail, from: new THREE.Vector3(), to: new THREE.Vector3(), t0: 0, live: false };
  });
  const bursts = Array.from({ length: BURSTS }, () => {
    const s = new THREE.Sprite(spriteMat()); s.visible = false; s.layers.set(layer); scene.add(s);
    return { s, t0: 0, live: false };
  });
  const queue = [];   // shots waiting for their moment: { at, from, to }
  const _p = new THREE.Vector3();

  return {
    /** progress 0..1 per section; up = that part of the shield is finished */
    setShield(state) {
      for (const [name, p] of Object.entries(parts)) {
        const st = state[name] || { progress: 0, up: false };
        p.up = !!st.up;
        const pr = Math.min(1, st.progress || 0);
        p.target = p.up ? 0.85 : pr > 0 ? 0.15 + 0.4 * pr : 0;   // building: comes together as you lock; up: solid
      }
    },
    /** a missed arrow reached a part that's up: flash it where it struck (world point) */
    shieldHit(name, at) {
      const p = parts[name];
      if (!p || !p.up) return;
      p.hit = 1;
      p.mat.uniforms.uHitAt.value.copy(at).sub(CENTER).setLength(R);
    },
    debug: () => ({ queued: queue.map((q) => +q.at.toFixed(2)), flying: bolts.filter((b) => b.live).map((b) => b.s.position.toArray().map((v) => +v.toFixed(1))), bursts: bursts.filter((u) => u.live).length }),
    /** a cannon shot from a bar (world) to its archer (world), at heard time `at` */
    fire(from, to, at) { queue.push({ at, from: from.clone(), to: to.clone() }); },
    update(heardNow, dt) {
      for (const p of Object.values(parts)) {
        p.value += (p.target - p.value) * (1 - Math.exp(-dt / 0.6));
        p.hit = Math.max(0, p.hit - dt * 2.5);
        p.mesh.visible = p.value > 0.005 || p.hit > 0.01;
        p.mat.uniforms.uStrength.value = p.value;
        p.mat.uniforms.uHit.value = p.hit;
        p.mat.uniforms.uTime.value = heardNow;
      }
      // fire what's due
      for (let i = queue.length - 1; i >= 0; i--) {
        if (heardNow < queue[i].at) continue;
        const q = queue.splice(i, 1)[0];
        const b = bolts.find((x) => !x.live);
        if (!b) continue;
        b.live = true; b.t0 = q.at; b.from.copy(q.from); b.to.copy(q.to); b.s.visible = true;
      }
      for (const b of bolts) {
        if (!b.live) continue;
        const f = (heardNow - b.t0) / BOLT_S;
        if (f >= 1) {
          b.live = false; b.s.visible = false; for (const t of b.trail) t.visible = false;
          const u = bursts.find((x) => !x.live);
          if (u) { u.live = true; u.t0 = heardNow; u.s.position.copy(b.to); u.s.visible = true; }
          continue;
        }
        const at = (ff, out) => { out.copy(b.from).lerp(b.to, ff); out.y += 2.2 * 4 * ff * (1 - ff); return out; };   // a shallow arc
        b.s.position.copy(at(f, _p));
        b.s.scale.setScalar(0.9 + 0.9 * f);              // grows as it goes: still clear far away
        b.trail.forEach((t, i) => {
          const ff = f - (i + 1) * 0.035;
          t.visible = ff > 0;
          if (ff > 0) { t.position.copy(at(ff, _p)); t.scale.setScalar((0.8 + 0.8 * ff) * (1 - (i + 1) / (TRAIL + 1))); t.material.opacity = 0.75 * (1 - (i + 1) / (TRAIL + 1)); }
        });
      }
      for (const u of bursts) {
        if (!u.live) continue;
        const g = (heardNow - u.t0) / 0.5;
        if (g >= 1) { u.live = false; u.s.visible = false; continue; }
        u.s.scale.setScalar(1.5 + 6 * g);
        u.s.material.opacity = 1 - g;
      }
    },
  };
}
