/* troops.js — the army you shell, drawn (owner, 2026-10-03: "they can blow up like
 * TABS, totally awesome battle simulator"). siege.js decides who lives; this draws them.
 *
 * Every body is the same little rig: 13 joints on sticks — a braced torso box,
 * a head, two-piece arms and legs. Alive, the joints follow a walk cycle (and a
 * swing at the shield once they reach it). Dead, the rig goes LIMP: each joint
 * keeps the speed it had, takes the blast's kick, and falls under gravity with
 * the sticks holding it together (Verlet) — so it flails, tumbles, bounces on the
 * paving and lies there floppy, then sinks away. The BOSS is the same rig, huge,
 * in dark iron, with its life over its head.
 *
 * createTroops(scene, { court(side) -> {fwd, right}, center, layer })
 *   -> { spawn(enemy), kill(enemy, by), bossHit(enemy), update(dt), debug() }
 */
import { gltfLoader } from "./gltf.js";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { attachAxe, setAxeGrip } from "./axe.js";
import { clone as skelClone } from "three/examples/jsm/utils/SkeletonUtils.js";

// joints: 0 head, 1 lSh, 2 rSh, 3 lHip, 4 rHip, 5 lEl, 6 lHand, 7 rEl, 8 rHand, 9 lKnee, 10 lFoot, 11 rKnee, 12 rFoot
const N = 13;
const STICKS = [
  [0, 1], [0, 2],                         // the head on both shoulders (it stays on)
  [1, 2], [3, 4], [1, 3], [2, 4], [1, 4], [2, 3],   // the torso, braced: it stays a box
  [1, 5], [5, 6], [2, 7], [7, 8],         // arms
  [3, 9], [9, 10], [4, 11], [11, 12],     // legs
];
// the drawn limbs: [a, b, thickness]
const LIMBS = [[1, 5, 0.09], [5, 6, 0.08], [2, 7, 0.09], [7, 8, 0.08], [3, 9, 0.12], [9, 10, 0.1], [4, 11, 0.12], [11, 12, 0.1]];
const G = 9.8, STEP = 1 / 60, ITER = 6;
const DEAD_S = 5, SINK_S = 1.5;
const MAX = 30;

/** the rig's pose (local: +z = the way it faces, y up, feet on 0), walking at phase ph, swinging if attacking */
function pose(out, ph, attacking, t, thrash = 0) {
  const sw = Math.sin(ph), lift = Math.max(0, Math.cos(ph)) * 0.12, lift2 = Math.max(0, -Math.cos(ph)) * 0.12;
  const bob = Math.abs(Math.sin(ph)) * 0.04;
  const set = (i, x, y, z) => out[i].set(x, y, z);
  if (thrash > 0) {   // the boss wrecking things: both arms hauled overhead and slammed down, the body heaving
    const k = Math.sin(thrash * Math.PI * 2), up = Math.max(0, k), down = Math.max(0, -k);
    set(0, 0, 1.62 + 0.1 * up - 0.12 * down, 0.1 * down);
    set(1, -0.22, 1.42, 0.08 * down); set(2, 0.22, 1.42, 0.08 * down);
    set(3, -0.12, 0.92, 0); set(4, 0.12, 0.92, 0);
    set(5, -0.4, 1.5 + 0.5 * up - 0.3 * down, 0.1 + 0.3 * down); set(6, -0.45, 1.5 + 0.9 * up - 0.95 * down, 0.2 + 0.6 * down);
    set(7, 0.4, 1.5 + 0.5 * up - 0.3 * down, 0.1 + 0.3 * down); set(8, 0.45, 1.5 + 0.9 * up - 0.95 * down, 0.2 + 0.6 * down);
    set(9, -0.14, 0.5, 0.12); set(10, -0.16, 0.02, 0.1); set(11, 0.14, 0.5, -0.1); set(12, 0.16, 0.02, -0.15);
    return;
  }
  set(0, 0, 1.68 + bob, 0);
  set(1, -0.2, 1.45 + bob, 0); set(2, 0.2, 1.45 + bob, 0);
  set(3, -0.12, 0.95 + bob, 0); set(4, 0.12, 0.95 + bob, 0);
  if (attacking) {   // both arms hacking at the shield
    const hack = Math.sin(t * 9);
    set(5, -0.28, 1.6, 0.25); set(6, -0.25, 1.55 + 0.35 * hack, 0.55 - 0.15 * hack);
    set(7, 0.28, 1.6, 0.25); set(8, 0.25, 1.55 - 0.35 * hack, 0.55 + 0.15 * hack);
    set(9, -0.13, 0.5, 0.05); set(10, -0.14, 0.02, 0); set(11, 0.13, 0.5, 0.05); set(12, 0.14, 0.02, 0);
    return;
  }
  set(5, -0.27, 1.17 + bob, -0.12 * sw); set(6, -0.29, 0.92 + bob, -0.3 * sw + 0.05);
  set(7, 0.27, 1.17 + bob, 0.12 * sw); set(8, 0.29, 0.92 + bob, 0.3 * sw + 0.05);
  set(9, -0.13, 0.5 + lift, 0.22 * sw + 0.05); set(10, -0.14, 0.03 + lift, 0.35 * sw);
  set(11, 0.13, 0.5 + lift2, -0.22 * sw + 0.05); set(12, 0.14, 0.03 + lift2, -0.35 * sw);
}

export function createTroops(scene, { court, center, layer = 0, fireTexture = null, models = true } = {}) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const ball = new THREE.SphereGeometry(0.5, 12, 10);
  // SELF-LIT (owner, 2026-10-03: "increase lighting of enemies so we can see em"): their own
  // glow, so they read from far down the court in the dusk shade
  const mats = {
    soldier: { body: new THREE.MeshStandardMaterial({ color: 0x2a6cf0, roughness: 0.7, emissive: 0x1d4fb8, emissiveIntensity: 0.9 }),
      limb: new THREE.MeshStandardMaterial({ color: 0x23365e, roughness: 0.8, emissive: 0x16306a, emissiveIntensity: 0.8 }),
      head: new THREE.MeshStandardMaterial({ color: 0xe0ac84, roughness: 0.7, emissive: 0x6a4028, emissiveIntensity: 0.8 }) },
    boss: { body: new THREE.MeshStandardMaterial({ color: 0x3a3a46, metalness: 0.6, roughness: 0.45, emissive: 0x2a0c08 }),
      limb: new THREE.MeshStandardMaterial({ color: 0x2c2c36, metalness: 0.5, roughness: 0.5, emissive: 0x1e0a08 }),
      head: new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.7, roughness: 0.4, emissive: 0xaa2010 }) },
  };
  const makeRig = (kind) => {
    const m = mats[kind], g = new THREE.Group();
    const torso = new THREE.Mesh(box, m.body), head = new THREE.Mesh(ball, m.head);
    const limbs = LIMBS.map(() => new THREE.Mesh(box, m.limb));
    for (const x of [torso, head, ...limbs]) { x.castShadow = true; g.add(x); }
    g.visible = false;
    scene.add(g);
    return {
      kind, g, torso, head, limbs, enemy: null, live: false, dead: false, deadAt: 0, t: 0, ph: Math.random() * 6,
      // big enough to read down the court, over the guns
      scale: kind === "boss" ? 4.2 : 1.8, pos: Array.from({ length: N }, () => new THREE.Vector3()), prev: Array.from({ length: N }, () => new THREE.Vector3()),
      rest: STICKS.map(() => 0), local: Array.from({ length: N }, () => new THREE.Vector3()),
    };
  };
  const rigs = Array.from({ length: MAX }, () => makeRig("soldier"));
  // THE SOLDIER MODEL (owner's "Canyon Sentinel", 2026-10-04; built like the cyclops): every
  // rig gets its own skinned copy and mixer — walks or spear-walks in (runs when far), slashes at the
  // wall; dead, it's thrown tumbling like the box ragdoll was, lies there, then sinks. Cheap tiers
  // (models: false) keep the box rigs.
  const sent = { template: null, clips: {} };
  // THE MINOTAURS (owner, 2026-10-07): the BASS court's enemies are minotaurs with axes, not
  // soldiers. His minotaur had no rig; tools/rig-from-mixamo.py gave it the Sentinel's
  // skeleton and clips (public/models/MinotaurRig.glb): it walks, runs and slashes by the same names.
  const mino = { template: null, clips: {} };
  const makeModel = (src) => {
    const root = skelClone(src.template); root.visible = false;
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    scene.add(root);
    const axe = src === mino ? attachAxe(root) : null;
    return { axe, axeT: 0, root, mixer: new THREE.AnimationMixer(root), action: null, name: null, v: new THREE.Vector3(), spin: new THREE.Vector3(),
      walk: src === mino ? "Walking" : Math.random() < 0.5 ? "Walking" : "Spear_Walk", clips: src.clips, kind: src === mino ? "minotaur" : "soldier" };
  };
  const attachModel = (r) => { r.models = r.models || {}; r.models.soldier = makeModel(sent); r.model = r.model || r.models.soldier; };
  if (models) gltfLoader().load("/models/Sentinel.glb", (gltf) => {
    sent.template = gltf.scene;
    gltf.scene.traverse((o) => { if (o.isMesh && o.material) { o.material.emissive = new THREE.Color(0x3a2418); o.material.emissiveIntensity = 0.55; } });   // a little self-light: they read in the dusk shade
    for (const c of gltf.animations) sent.clips[c.name] = c;
    for (const r of rigs) attachModel(r);
  }, undefined, (err) => console.warn("Sentinel model failed to load — the box soldiers stand in", err));
  if (models) gltfLoader().load("/models/MinotaurRig.glb", (gltf) => {
    mino.template = gltf.scene;
    gltf.scene.traverse((o) => { if (o.isMesh && o.material) { o.material.emissive = new THREE.Color(0x3a2418); o.material.emissiveIntensity = 0.45; } });
    for (const c of gltf.animations) mino.clips[c.name] = c;
    for (const r of rigs) { r.models = r.models || {}; r.models.minotaur = makeModel(mino); }
  }, undefined, (err) => console.warn("MinotaurRig model failed to load — soldiers stand in at the bass court", err));
  const modelPlay = (m, name, speed = 1) => {
    if (!m.clips[name]) return;
    if (m.name === name) { if (m.action) m.action.timeScale = speed; return; }
    const a = m.mixer.clipAction(m.clips[name]); a.reset(); a.timeScale = speed; a.paused = false; a.setLoop(THREE.LoopRepeat, Infinity);
    if (m.action && m.action !== a) m.action.crossFadeTo(a, 0.2, false);
    a.play(); m.action = a; m.name = name;
  };
  const _mf = new THREE.Vector3(), _Zm = new THREE.Vector3(0, 0, 1);
  /** a living soldier's model: on the rig's spot, facing the dome, its clip by state */
  const drawModel = (r, dt) => {
    const m = r.model, e = r.enemy, c = court(e.side);
    r.g.visible = false; m.root.visible = true;
    m.root.position.copy(r.base); m.root.scale.setScalar(r.scale);
    m.root.quaternion.setFromUnitVectors(_Zm, _mf.copy(c.fwd).negate());
    if (e.kind === "balloon") { modelPlay(m, "Walking", 1); if (m.action) { m.action.paused = true; m.action.time = 0.35; } }
    else if (e.attacking) modelPlay(m, "Right_Hand_Sword_Slash", 1);
    else if (e.dist > 16) modelPlay(m, "Running", 0.9 * (e.speed || 1.6) / 1.6);
    else modelPlay(m, m.walk, (e.speed || 1.6) / 1.6);
    if (m.axe) { m.axeT += ((e.attacking ? 1 : 0) - m.axeT) * Math.min(1, dt * 8); setAxeGrip(m.axe, m.axeT); }   // carried upright, gripped to chop
    m.mixer.update(dt);
  };
  /** a dead soldier's model: thrown, tumbling, bouncing once, then lying, then sinking */
  const deadModel = (r, dt) => {
    const m = r.model, age = r.t - r.deadAt;
    if (m.action) m.action.paused = true;
    if (age < DEAD_S) {
      m.root.position.addScaledVector(m.v, dt); m.v.y -= 9.8 * dt;
      if (m.root.position.y < 0) { m.root.position.y = 0; m.v.y = Math.abs(m.v.y) * 0.25; m.v.x *= 0.6; m.v.z *= 0.6; m.spin.multiplyScalar(0.5); if (m.v.y < 0.6) m.v.set(0, 0, 0); }
      const w = m.spin.length();
      if (w > 0.01) { m.root.rotateOnAxis(_mf.copy(m.spin).divideScalar(w), w * dt); if (m.v.lengthSq() < 1e-4) m.spin.multiplyScalar(Math.exp(-dt * 4)); }
    } else m.root.position.y = -(age - DEAD_S) / SINK_S * 1.2 * r.scale;
    if (age > DEAD_S + SINK_S) { r.live = false; m.root.visible = false; r.enemy = null; }
  };
  // BALLOON GUYS (owner, 2026-10-04): a soldier in a basket under an envelope; a shell POPS the envelope and he drops
  const envMat = new THREE.MeshStandardMaterial({ color: 0xe04a30, roughness: 0.6, emissive: 0x501208, emissiveIntensity: 0.8, transparent: true, opacity: 0.95 });
  const balloons = Array.from({ length: 6 }, () => {
    const env = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 14), envMat.clone()); env.scale.y = 1.15;
    const basket = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 1.0), new THREE.MeshStandardMaterial({ color: 0x5a3b20, roughness: 0.9 }));
    for (const m of [env, basket]) { m.castShadow = true; m.visible = false; scene.add(m); }
    return { env, basket, rig: null, pop: -1 };
  });
  const bossRig = makeRig("boss");
  // THE BOSS MODEL (owner's "Canyon Cyclops", 2026-10-04; tools/build-cyclops.py folds its
  // six clips into public/models/Cyclops.glb): it stands on the box rig's spot and plays Walking as
  // it lumbers, Attack at the wall, Double_Combo_Attack when it thrashes, Hit_Reaction when the
  // lightning lands; no death clip, so it topples. The box rig stays as the fallback.
  const cyc = { root: null, mixer: null, clips: {}, action: null, name: null, once: null, hitMat: [], topple: 0 };
  gltfLoader().load("/models/Cyclops.glb", (gltf) => {
    cyc.root = gltf.scene; cyc.root.visible = false; scene.add(cyc.root);
    cyc.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (o.material) { o.material.emissive = new THREE.Color(0, 0, 0); cyc.hitMat.push(o.material); } } });
    cyc.mixer = new THREE.AnimationMixer(cyc.root);
    for (const c of gltf.animations) cyc.clips[c.name] = c;
  }, undefined, (err) => console.warn("Cyclops model failed to load — the box boss stands in", err));
  /** play a clip: looping, or once (then back to the loop) — crossfaded */
  const cycPlay = (name, { once = false, speed = 1 } = {}) => {
    if (!cyc.mixer || !cyc.clips[name]) return;
    if (cyc.name === name && !once) return;
    const next = cyc.mixer.clipAction(cyc.clips[name]);
    next.reset(); next.enabled = true; next.timeScale = speed;
    if (once) { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = false; }
    else next.setLoop(THREE.LoopRepeat, Infinity);
    if (cyc.action && cyc.action !== next) { cyc.action.crossFadeTo(next, 0.25, false); }
    next.play();
    if (once) { const back = cyc.name; cyc.once = { action: next, back, end: cyc.mixer.time + cyc.clips[name].duration / speed - 0.2 }; }
    else { cyc.action = next; cyc.name = name; }
  };
  // the boss's life, over its head
  const barCanvas = document.createElement("canvas"); barCanvas.width = 256; barCanvas.height = 40;
  const barTex = new THREE.CanvasTexture(barCanvas);
  const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: barTex, transparent: true, depthWrite: false, depthTest: false, fog: false }));
  bar.scale.set(2.6, 0.4, 1); bar.renderOrder = 21; bar.layers.set(layer); bar.visible = false; scene.add(bar);
  const drawBar = (f) => {
    const g = barCanvas.getContext("2d");
    g.clearRect(0, 0, 256, 40);
    g.fillStyle = "rgba(10,4,4,0.8)"; g.fillRect(0, 6, 256, 28);
    g.fillStyle = f > 0.3 ? "#e8332a" : "#ff8a2a"; g.fillRect(4, 10, 248 * Math.max(0, f), 20);
    g.strokeStyle = "#ffd27a"; g.lineWidth = 3; g.strokeRect(1.5, 7.5, 253, 25);
    barTex.needsUpdate = true;
  };
  let bossFlash = 0;

  const _q = new THREE.Quaternion(), _fwd = new THREE.Vector3(), _base = new THREE.Vector3(), _v = new THREE.Vector3(), _a = new THREE.Vector3(),
        _b = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4(), _Z = new THREE.Vector3(0, 0, 1);
  /** where an enemy stands (world) and which way it faces */
  const place = (e, out) => {
    const c = court(e.side);
    return out.copy(center).addScaledVector(c.fwd, e.dist).addScaledVector(c.right, e.lat).setY(e.alt || 0);
  };
  /** the living pose, in the world */
  const dusts = Array.from({ length: 14 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTexture, color: 0x8a7a66, transparent: true, depthWrite: false, fog: false })); s.layers.set(layer); s.visible = false; scene.add(s); return { s, t0: -1e9, v: new THREE.Vector3() }; });
  const dust = (at) => { const d = dusts.reduce((a, b) => (a.t0 < b.t0 ? a : b)); d.t0 = clock; d.s.position.copy(at); d.s.visible = true; d.v.set((Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2); };
  let clock = 0;
  const posed = (r, e, dt) => {
    r.t += dt;
    let thrash = 0;
    if (e.kind === "boss" && !e.attacking) {   // every few steps it stops and WRECKS something (owner): a 1.6 s two-fisted slam
      if (r.thrashAt == null) r.thrashAt = r.t + 4;
      if (r.t >= r.thrashAt) { r.thrashing = r.t; r.thrashAt = r.t + 1.6 + 3 + Math.random() * 3; }
      if (r.thrashing != null && r.t - r.thrashing < 1.6) { thrash = (r.t - r.thrashing) / 1.6; if (thrash > 0.72 && !r.slammed) { r.slammed = true; const c = court(e.side); for (const sgn of [-1, 1]) for (let k = 0; k < 4; k++) dust(_base.clone().addScaledVector(c.fwd, -0.9 * r.scale).addScaledVector(c.right, sgn * 0.45 * r.scale)); } }
      else { r.thrashing = null; r.slammed = false; }
    }
    if (!e.attacking && !thrash) r.ph += dt * (e.kind === "boss" ? 3.2 : 7.5 * (e.speed ? e.speed / 1.6 : 1));
    pose(r.local, r.ph, e.attacking, r.t, thrash);
    place(e, _base);
    if (e.kind === "soldier") _base.addScaledVector(court(e.side).right, Math.sin(r.t * 1.7 + r.ph0) * 0.22);   // a loose mob: they weave as they come
    (r.base || (r.base = new THREE.Vector3())).copy(_base);
    _fwd.copy(court(e.side).fwd).negate();   // they face the dome
    _q.setFromUnitVectors(_Z, _fwd);
    for (let i = 0; i < N; i++) {
      r.prev[i].copy(r.pos[i]);
      r.pos[i].copy(r.local[i]).multiplyScalar(r.scale).applyQuaternion(_q).add(_base);
    }
  };
  /** the limp body: Verlet with the sticks holding it together, the paving under it */
  const limp = (r, dt) => {
    const s = r.scale;
    for (let step = 0; step < Math.max(1, Math.round(dt / STEP)); step++) {
      for (let i = 0; i < N; i++) {
        const p = r.pos[i], q = r.prev[i];
        _v.copy(p).sub(q).multiplyScalar(0.995);
        q.copy(p);
        p.add(_v); p.y -= G * STEP * STEP;
      }
      for (let k = 0; k < ITER; k++) {
        STICKS.forEach(([a, b], j) => {
          const pa = r.pos[a], pb = r.pos[b];
          _a.copy(pb).sub(pa);
          const d = _a.length() || 1e-6, diff = (d - r.rest[j]) / d * 0.5;
          pa.addScaledVector(_a, diff); pb.addScaledVector(_a, -diff);
        });
        for (let i = 0; i < N; i++) {
          const p = r.pos[i], floor = (i === 0 ? 0.12 : 0.05) * s;
          if (p.y < floor) {   // the paving: stop, and drag (friction)
            p.y = floor;
            const q = r.prev[i];
            q.x += (p.x - q.x) * 0.35; q.z += (p.z - q.z) * 0.35;
            if (q.y < p.y - 0.001) q.y = p.y + (p.y - q.y) * 0.3;   // a little bounce
          }
        }
      }
    }
  };
  /** the meshes on the joints */
  const draw = (r, sink = 0) => {
    const s = r.scale, P = r.pos;
    // torso: centred on the four corners, its axes from them
    _a.copy(P[1]).add(P[2]).add(P[3]).add(P[4]).multiplyScalar(0.25);
    _x.copy(P[2]).sub(P[1]).add(P[4]).sub(P[3]).normalize();
    _y.copy(P[1]).sub(P[3]).add(P[2]).sub(P[4]).normalize();
    _z.crossVectors(_x, _y).normalize(); _y.crossVectors(_z, _x);
    _m.makeBasis(_x, _y, _z);
    r.torso.quaternion.setFromRotationMatrix(_m);
    r.torso.position.copy(_a).setY(_a.y - sink);
    r.torso.scale.set(0.46 * s, 0.56 * s, 0.24 * s);
    r.head.position.copy(P[0]).setY(P[0].y - sink); r.head.scale.setScalar(0.27 * s);
    LIMBS.forEach(([a, b, th], i) => {
      const m = r.limbs[i];
      _b.copy(P[b]).sub(P[a]);
      const len = _b.length() || 1e-6;
      m.position.copy(P[a]).addScaledVector(_b, 0.5); m.position.y -= sink;
      m.quaternion.setFromUnitVectors(_y.set(0, 1, 0), _b.divideScalar(len));
      m.scale.set(th * s, len, th * s);
    });
  };

  return {
    spawn(e) {
      const r = e.kind === "boss" ? bossRig : rigs.find((x) => !x.live);
      if (!r) return;
      r.live = true; r.dead = false; r.enemy = e; r.t = 0; r.g.visible = true; r.ph0 = Math.random() * 6; r.thrashAt = null; r.thrashing = null;
      r.scale = e.kind === "boss" ? 3.2 : e.kind === "balloon" ? 1.0 : 1.0 + Math.random() * 0.25;   // human-sized (owner: "they are huge"), the boss three men tall
      for (const m of Object.values(r.models || {})) { m.mixer.stopAllAction(); m.action = null; m.name = null; m.root.quaternion.identity(); m.root.visible = false; m.v.set(0, 0, 0); m.spin.set(0, 0, 0); }
      // which body: minotaurs (with axes) at the bass court, soldiers everywhere else (owner, 2026-10-07)
      if (r.models) r.model = (e.side === "bass" && e.kind === "soldier" && r.models.minotaur) || r.models.soldier || r.model;
      if (r.model && r.model.kind === "minotaur") r.scale *= 1.12;   // a head taller than the soldiers
      if (e.kind === "balloon") { const bl = balloons.find((x) => !x.rig); if (bl) { bl.rig = r; bl.pop = -1; bl.env.visible = bl.basket.visible = true; bl.env.scale.setScalar(1); bl.env.material.opacity = 0.95; } }
      posed(r, e, 0);
      for (let i = 0; i < N; i++) r.prev[i].copy(r.pos[i]);
      STICKS.forEach(([a, b], j) => (r.rest[j] = r.pos[a].distanceTo(r.pos[b])));
      if (e.kind === "boss") { drawBar(1); bar.visible = true; cyc.name = null; cyc.action = null; cyc.once = null; if (cyc.mixer) cyc.mixer.stopAllAction(); }
    },
    /** BOOM: the rig goes limp, kicked away from the blast (by: where the shell landed) */
    kill(e, by) {
      const r = e.kind === "boss" ? bossRig : rigs.find((x) => x.live && x.enemy === e);
      if (!r || r.dead) return;
      r.dead = true; r.deadAt = r.t;
      const bl = balloons.find((x) => x.rig === r); if (bl) bl.pop = clock;   // POP
      const c = court(e.side);
      _b.copy(center).addScaledVector(c.fwd, by.dist).addScaledVector(c.right, by.lat).setY(0);   // the blast
      const big = e.kind === "boss" ? 0.5 : 1;
      for (let i = 0; i < N; i++) {
        _v.copy(r.pos[i]).sub(_b); _v.y = 0;
        const d = _v.length();
        if (d < 0.3) _v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        _v.normalize().multiplyScalar((5 + 4 * Math.random()) * big / Math.max(1, d * 0.6));
        _v.y = (7 + 5 * Math.random() + (i === 0 ? 2 : 0)) * big;   // up and over
        _v.x += (Math.random() - 0.5) * 2.5; _v.z += (Math.random() - 0.5) * 2.5;
        r.prev[i].copy(r.pos[i]).addScaledVector(_v, -STEP);   // Verlet: a speed is the step back
      }
      if (r.model) {   // the model is thrown whole: the joints' mean kick, and a tumble
        const m = r.model; m.v.set(0, 0, 0);
        for (let i = 0; i < N; i++) m.v.add(_v.copy(r.pos[i]).sub(r.prev[i]).divideScalar(STEP));
        m.v.divideScalar(N); m.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(5 + 5 * Math.random());
      }
      if (e.kind === "boss") bar.visible = false;
    },
    bossHit(e) { drawBar(e.hp / e.of); bossFlash = 1; if (!bossRig.dead) cycPlay("Hit_Reaction", { once: true, speed: 1.3 }); },
    update(dt) {
      dt = Math.min(dt, 0.05);
      clock += dt;
      for (const bl of balloons) {
        if (!bl.rig) continue;
        const r = bl.rig;
        if (!r.live) { bl.rig = null; bl.env.visible = bl.basket.visible = false; continue; }
        _a.copy(r.pos[3]).add(r.pos[4]).multiplyScalar(0.5);   // the hips
        bl.basket.position.copy(_a); bl.basket.position.y -= 0.35 * r.scale;
        if (bl.pop < 0) { bl.env.position.copy(_a); bl.env.position.y += 2.4 * r.scale; }
        else { const k = (clock - bl.pop) / 0.25; if (k >= 1) bl.env.visible = false; else { bl.env.scale.setScalar(1 + 0.8 * k); bl.env.material.opacity = 0.95 * (1 - k); } }
      }
      for (const d of dusts) { const age = clock - d.t0; if (age > 0.9) { d.s.visible = false; continue; } d.s.position.addScaledVector(d.v, dt); d.v.y -= dt * 1.5; d.s.scale.setScalar((0.6 + 1.6 * age) * 1.5); d.s.material.opacity = 0.55 * (1 - age / 0.9); }
      bossFlash = Math.max(0, bossFlash - dt * 4);
      mats.boss.body.emissive.setRGB(0.16 + 0.9 * bossFlash, 0.05 + 0.15 * bossFlash, 0.03 + 0.05 * bossFlash);   // a dull red heat, flaring when hit
      if (cyc.mixer) {
        cyc.mixer.update(dt);
        if (cyc.once && cyc.mixer.time >= cyc.once.end) { const o = cyc.once; cyc.once = null; if (o.back && cyc.clips[o.back]) { const a = cyc.mixer.clipAction(cyc.clips[o.back]); a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.play(); o.action.crossFadeTo(a, 0.25, false); cyc.action = a; cyc.name = o.back; } }
        for (const m of cyc.hitMat) m.emissive.setRGB(1.2 * bossFlash, 0.15 * bossFlash, 0.05 * bossFlash);   // flares when the lightning lands
      }
      for (const r of [...rigs, bossRig]) {
        if (!r.live) continue;
        const useModel = r === bossRig && cyc.root;
        if (!r.dead) {
          posed(r, r.enemy, dt);
          if (useModel) {
            // the model stands on the rig's spot, facing the dome; its clip follows the enemy's state
            const e = r.enemy, c = court(e.side);
            cyc.root.visible = true; r.g.visible = false;
            cyc.root.position.copy(center).addScaledVector(c.fwd, e.dist).addScaledVector(c.right, e.lat).setY(0);
            cyc.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), c.fwd.clone().negate());
            cyc.root.scale.setScalar(r.scale);
            const thrashing = r.thrashing != null && r.t - r.thrashing < 1.6;
            if (e.attacking) cycPlay("Attack");
            else if (thrashing) { if (cyc.name !== "Double_Combo_Attack") cycPlay("Double_Combo_Attack", { speed: 1.1 }); }
            else cycPlay("Walking", { speed: 0.35 });
            bar.position.copy(cyc.root.position).setY(1.7 * r.scale + 0.6);
          } else if (r.model && sent.template) {
            drawModel(r, dt);
          } else {
            draw(r);
            if (r === bossRig) bar.position.copy(r.pos[0]).setY(r.pos[0].y + 0.9 * r.scale * 0.5 + 0.6);
          }
          continue;
        }
        if (r.model && sent.template) { r.t += dt; deadModel(r, dt); continue; }
        if (useModel) {   // down: it topples forward over a second, lies there, then sinks away
          r.t += dt;
          const age = r.t - r.deadAt;
          if (cyc.action) { cyc.action.paused = true; }
          const k = Math.min(1, age / 1.1), fall = 1 - Math.pow(1 - k, 3);
          const c = court(r.enemy.side);
          cyc.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), c.fwd.clone().negate()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), fall * Math.PI / 2));
          const sink = age > DEAD_S ? (age - DEAD_S) / SINK_S * 0.8 * r.scale : 0;
          cyc.root.position.y = -sink;
          if (age > DEAD_S + SINK_S) { r.live = false; cyc.root.visible = false; r.enemy = null; if (cyc.action) { cyc.action.paused = false; } }
          continue;
        }
        r.t += dt;
        const age = r.t - r.deadAt;
        if (age < DEAD_S) limp(r, dt);
        const sink = age > DEAD_S ? (age - DEAD_S) / SINK_S * 0.6 * r.scale : 0;
        draw(r, sink);
        if (age > DEAD_S + SINK_S) { r.live = false; r.g.visible = false; r.enemy = null; }
      }
    },
    debug: () => ({ alive: rigs.filter((r) => r.live && !r.dead).length, limp: rigs.filter((r) => r.live && r.dead).length, boss: bossRig.live ? (bossRig.dead ? "down" : "up") : "-" }),
  };
}
