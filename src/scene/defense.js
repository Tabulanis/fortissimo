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
const BOLT_S = 0.9;                  // a shell's flight time (long enough to watch it go)
const BOLTS = 16, BURSTS = 16;

const VERT = `varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vP;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vUv = uv; vP = position; vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`;
// the owner's two SWIRLS (public/textures/shield_swirl.jpg + shield_swirl_bright.jpg,
// equirect), wrapped by direction so they run seamless over all three parts:
// the main one turns one way, the bright one the other with its own warp, and
// where they cross the shield brightens; the bright layer swells and ebbs.
// Brightness IS opacity (the dark goes clear), pushed bright for a bloomed glow.
// Toward the floor it fades out smoothly (no hard line where it meets the ground).
const FRAG = `uniform vec3 uColor; uniform float uStrength, uTime, uHit; uniform vec3 uHitAt; uniform sampler2D uTex, uTexB;
varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vP;
void main() {
  vec3 d = normalize(vP);
  vec2 base = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
  vec2 w = vec2(sin(base.y * 14.0 + uTime * 0.9) + sin(base.x * 23.0 - uTime * 0.6),
                cos(base.x * 17.0 + uTime * 0.7) + sin(base.y * 9.0 - uTime * 1.1)) * 0.012;
  vec3 main = texture2D(uTex, base + w + vec2(uTime * 0.03, 0.0)).rgb;
  vec2 w2 = vec2(cos(base.y * 11.0 - uTime * 0.8), sin(base.x * 19.0 + uTime * 0.5)) * 0.016;
  vec3 bright = texture2D(uTexB, vec2(1.0 - base.x, base.y) + w2 + vec2(-uTime * 0.02, 0.0)).rgb;
  float lm = dot(main, vec3(0.299, 0.587, 0.114)), lb = dot(bright, vec3(0.299, 0.587, 0.114));
  float swell = 0.55 + 0.45 * sin(uTime * 0.35 + base.x * 6.2831853);      // the bright layer ebbs and swells round the dome
  vec3 sw = main * 1.3 + bright * swell * 1.1 + main * bright * 2.2;       // brighter where they cross
  float lum = max(lm, lb * swell) + lm * lb * 1.5;
  float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 3.0);
  float floorFade = smoothstep(0.0, 0.18, vUv.y);                           // soft into the ground
  float hit = uHit * smoothstep(1.6, 0.0, distance(vP, uHitAt));
  float a = (uStrength * (pow(lum, 1.6) * 1.1 + 0.15 * rim) + hit * (0.4 + lum)) * floorFade;
  gl_FragColor = vec4(mix(sw * 1.5, uColor, 0.2) + uColor * (0.5 * rim + hit), a);
}`;

export function createDefense(scene, { fireTexture, layer = 0, glowLayer = null } = {}) {
  const group = new THREE.Group();
  group.position.copy(CENTER);
  scene.add(group);

  const swirl = new THREE.TextureLoader().load("/textures/shield_swirl.jpg");
  swirl.colorSpace = THREE.SRGBColorSpace;
  swirl.wrapS = THREE.RepeatWrapping;
  const swirlBright = new THREE.TextureLoader().load("/textures/shield_swirl_bright.jpg");
  swirlBright.colorSpace = THREE.SRGBColorSpace;
  swirlBright.wrapS = THREE.RepeatWrapping;
  // ---- the shield: three sector meshes -------------------------------------
  const parts = {};
  for (const [name, mid] of Object.entries(SECTORS)) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x58c8ff) }, uStrength: { value: 0 }, uTime: { value: 0 }, uHit: { value: 0 }, uHitAt: { value: new THREE.Vector3() }, uTex: { value: swirl }, uTexB: { value: swirlBright } },
    });
    const geo = new THREE.SphereGeometry(R, 48, 16, mid - Math.PI / 3, (2 * Math.PI) / 3, 0, Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.layers.set(layer);
    if (glowLayer != null) mesh.layers.enable(glowLayer);   // its own channel: only the shield gets the magic bloom
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
  // EXPLOSIONS where a shell lands (owner, 2026-10-03): a white flash, an orange
  // fireball, six embers thrown out and falling, a puff of smoke rising
  // a soft ROUND glow for the blast (the flame texture is a narrow teardrop — a blast drawn with it looked tiny)
  const blastTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,0.85)");
    r.addColorStop(0.6, "rgba(255,255,255,0.3)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const mk = (color, additive = true, map = blastTex) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, depthWrite: false, transparent: true, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.visible = false; s.layers.set(layer); scene.add(s); return s;
  };
  const bursts = Array.from({ length: BURSTS }, () => ({
    flash: mk(0xffffff), ball: mk(0xff8a30), smoke: mk(0x55504a, false),
    embers: Array.from({ length: 6 }, () => ({ s: mk(0xffc060, true, fireTexture), v: new THREE.Vector3() })),
    at: new THREE.Vector3(), t0: 0, live: false,
  }));
  const explode = (at, now) => {
    const u = bursts.find((x) => !x.live);
    if (!u) return;
    u.live = true; u.t0 = now; u.at.copy(at);
    for (const sp of [u.flash, u.ball, u.smoke]) { sp.position.copy(at); sp.visible = true; }
    for (const e of u.embers) {
      e.s.position.copy(at); e.s.visible = true;
      e.v.set(Math.random() - 0.5, 0.6 + Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(7 + Math.random() * 7);
    }
  };
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
          explode(b.to, heardNow);
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
        const t = heardNow - u.t0;
        if (t >= 1.6) { u.live = false; for (const sp of [u.flash, u.ball, u.smoke, ...u.embers.map((e) => e.s)]) sp.visible = false; continue; }
        const fl = Math.min(1, t / 0.25);                       // flash: 0.25 s
        u.flash.scale.setScalar(4 + 16 * fl); u.flash.material.opacity = 1 - fl; u.flash.visible = fl < 1;
        const bl = Math.min(1, t / 0.8);                        // fireball: 0.8 s
        u.ball.scale.setScalar(3 + 9 * Math.sqrt(bl));   // big enough to read from 26 m u.ball.material.opacity = 0.95 * (1 - bl); u.ball.visible = bl < 1;
        const sm = Math.min(1, t / 1.6);                        // smoke: rises and spreads, 1.6 s
        u.smoke.position.set(u.at.x, u.at.y + 1.8 * sm, u.at.z);
        u.smoke.scale.setScalar(3.5 + 8 * sm); u.smoke.material.opacity = 0.5 * Math.sin(Math.PI * Math.min(1, sm * 1.2));
        for (const e of u.embers) {                             // embers: ballistic, fading over 1.2 s
          const k = Math.min(1, t / 1.2);
          e.s.position.set(u.at.x + e.v.x * t, u.at.y + e.v.y * t - 4.9 * t * t, u.at.z + e.v.z * t);
          e.s.scale.setScalar(0.7 * (1 - k) + 0.1); e.s.material.opacity = 1 - k; e.s.visible = k < 1;
        }
      }
    },
  };
}
