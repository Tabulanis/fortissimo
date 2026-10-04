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
import * as THREE from "three";

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
function pose(out, ph, attacking, t) {
  const sw = Math.sin(ph), lift = Math.max(0, Math.cos(ph)) * 0.12, lift2 = Math.max(0, -Math.cos(ph)) * 0.12;
  const bob = Math.abs(Math.sin(ph)) * 0.04;
  const set = (i, x, y, z) => out[i].set(x, y, z);
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

export function createTroops(scene, { court, center, layer = 0 } = {}) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const ball = new THREE.SphereGeometry(0.5, 12, 10);
  const mats = {
    soldier: { body: new THREE.MeshStandardMaterial({ color: 0x1f5fd6, roughness: 0.7, emissive: 0x051a40 }), limb: new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.8 }),
      head: new THREE.MeshStandardMaterial({ color: 0xd9a27a, roughness: 0.7 }) },
    boss: { body: new THREE.MeshStandardMaterial({ color: 0x34343e, metalness: 0.7, roughness: 0.45, emissive: 0x000000 }),
      limb: new THREE.MeshStandardMaterial({ color: 0x24242c, metalness: 0.6, roughness: 0.5 }),
      head: new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.7, roughness: 0.4, emissive: 0x551008 }) },
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
  const bossRig = makeRig("boss");
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
    return out.copy(center).addScaledVector(c.fwd, e.dist).addScaledVector(c.right, e.lat).setY(0);
  };
  /** the living pose, in the world */
  const posed = (r, e, dt) => {
    r.t += dt;
    if (!e.attacking) r.ph += dt * (e.kind === "boss" ? 3.2 : 7.5);
    pose(r.local, r.ph, e.attacking, r.t);
    place(e, _base);
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
      r.live = true; r.dead = false; r.enemy = e; r.t = 0; r.g.visible = true;
      posed(r, e, 0);
      for (let i = 0; i < N; i++) r.prev[i].copy(r.pos[i]);
      STICKS.forEach(([a, b], j) => (r.rest[j] = r.pos[a].distanceTo(r.pos[b])));
      if (e.kind === "boss") { drawBar(1); bar.visible = true; }
    },
    /** BOOM: the rig goes limp, kicked away from the blast (by: where the shell landed) */
    kill(e, by) {
      const r = e.kind === "boss" ? bossRig : rigs.find((x) => x.live && x.enemy === e);
      if (!r || r.dead) return;
      r.dead = true; r.deadAt = r.t;
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
      if (e.kind === "boss") bar.visible = false;
    },
    bossHit(e) { drawBar(e.hp / e.of); bossFlash = 1; },
    update(dt) {
      dt = Math.min(dt, 0.05);
      bossFlash = Math.max(0, bossFlash - dt * 4);
      mats.boss.body.emissive.setRGB(0.9 * bossFlash, 0.15 * bossFlash, 0.05 * bossFlash);
      for (const r of [...rigs, bossRig]) {
        if (!r.live) continue;
        if (!r.dead) {
          posed(r, r.enemy, dt);
          draw(r);
          if (r === bossRig) bar.position.copy(r.pos[0]).setY(r.pos[0].y + 0.9 * r.scale * 0.5 + 0.6);
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
