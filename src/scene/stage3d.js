/* stage3d.js — seated first-person 3D layout.
   Lanes 0-2 (layout.top): upright hand drums facing the player.
   Lanes 3-5 (layout.bottom): floor drums in front, heads facing up.
   Flaming billboard arrows fly in on the audio clock (the arrows ARE the
   notes), arcing in so they are always seen side-on. All effect lighting
   is fake: additive sprite flames and glows, no PointLights. */

import * as THREE from "three";

const APPROACH_S = 3.2;   // seconds of visible flight: launched from the far wall, tracked all the way
const STUCK_S = 0.6;      // seconds an unhit arrow stays stuck at the face

// module-level temps: no per-frame allocations
const UP = new THREE.Vector3(0, 1, 0);
const _tan = new THREE.Vector3();
const _pA = new THREE.Vector3();
const _pB = new THREE.Vector3();


// lane index -> drum placement.
// lanes 0-2: upright hand drums (cylinder axis along z, face toward +z).
// lanes 3-5: floor drums (cylinder axis vertical, head up).
const LANES3D = [
  { x: -0.8, y: 1.2, z: -1.4, radius: 0.3, depth: 0.16, upright: true },
  { x: 0.0, y: 1.2, z: -1.4, radius: 0.3, depth: 0.16, upright: true },
  { x: 0.8, y: 1.2, z: -1.4, radius: 0.3, depth: 0.16, upright: true },
  { x: -0.75, y: 0.36, z: -0.25, radius: 0.32, depth: 0.36, upright: false },
  { x: 0.0, y: 0.36, z: -0.25, radius: 0.32, depth: 0.36, upright: false },
  { x: 0.75, y: 0.36, z: -0.25, radius: 0.32, depth: 0.36, upright: false },
];

// arrow spawn points per lane: archers spread across the FAR courtyard wall
// (~70 m out). Every arrow is visible from launch and lobs in on a high arc;
// the horizontal fan keeps each shaft readable side-on, never a dot.
const SPAWNS = [
  new THREE.Vector3(-38, 3.0, -55),   // upright 0  — far left
  new THREE.Vector3(-24, 3.0, -62),   // upright 1  — left of centre (never dead centre: a centre arc is seen edge-on)
  new THREE.Vector3(38, 3.0, -55),    // upright 2  — far right
  new THREE.Vector3(-30, 2.5, -48),   // floor 3
  new THREE.Vector3(26, 2.5, -60),    // floor 4    — right of centre
  new THREE.Vector3(30, 2.5, -48),    // floor 5
];

// arc height of the parabolic lift on top of the straight line: a real lob
const ARC_LIFT = [6.5, 6.5, 6.5, 8, 8, 8];

function hexToColor(s) {
  return new THREE.Color(s);   // accepts "#rrggbb"
}

// shared module-level effect temps (one allocation, reused every frame)
const _eVel = new THREE.Vector3();
const _ePos = new THREE.Vector3();
const _eDir = new THREE.Vector3();
const _eTang = new THREE.Vector3();
const _eSide = new THREE.Vector3();
const _eGrav = new THREE.Vector3(0, -6, 0);
const _eQ = new THREE.Quaternion();
const _eAxis = new THREE.Vector3();
const _eWhite = new THREE.Color(0xffffff);

/**
 * Build the scene once.
 * @param {HTMLCanvasElement} canvas the WebGL canvas (canvas#stage)
 * @param {{top: Array, bottom: Array}} layout the drum layout (row order)
 * @param {Object<string,string>} colors drum-name -> hex colour string
 * @returns {{resize: Function, update: Function, hit: Function, press: Function}}
 */
export function createStage3D(canvas, layout, colors) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x05070d, 0.02);   // fire ignores fog (fog:false on sprites)

  scene.add(new THREE.AmbientLight(0x404860, 0.6));
  const dir = new THREE.DirectionalLight(0x8090c0, 0.4);
  dir.position.set(2, 5, 6);
  scene.add(dir);

  const camera = new THREE.PerspectiveCamera(
    60, canvas.clientWidth / canvas.clientHeight, 0.1, 200,
  );
  camera.position.set(0, 1.3, 2.0);
  camera.lookAt(new THREE.Vector3(0, 2.1, -10));   // horizon up: the far wall and the arcs are in view

  // ground: dark stone, flat at y = 0
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // drums
  const drumMat = [];
  const drumPos = [];
  const drumFace = [];
  for (let i = 0; i < 6; i++) {
    const lane = i < 3 ? layout.top[i] : layout.bottom[i - 3];
    const color = hexToColor(colors[lane.drum] || "#888888");
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: 0x000000,
      roughness: 0.5,
      metalness: 0.1,
    });
    drumMat.push(mat);

    const L = LANES3D[i];
    const geo = new THREE.CylinderGeometry(L.radius, L.radius, L.depth, 24);
    if (L.upright) geo.rotateX(Math.PI / 2);   // axis along z, face toward +z
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(L.x, L.y, L.z);
    scene.add(mesh);
    drumPos.push(new THREE.Vector3(L.x, L.y, L.z));
    if (L.upright) {
      drumFace.push(new THREE.Vector3(L.x, L.y, L.z + L.depth / 2 + 0.02));
    } else {
      drumFace.push(new THREE.Vector3(L.x, L.y + L.depth / 2 + 0.02, L.z));
    }
  }

  // flame texture: built ONCE, a 64x64 radial gradient
  const flameTexture = (() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  // shared arrow geometry (one allocation)
  const shaftGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6);
  shaftGeo.translate(0, -0.1, 0);   // shaft trails behind the head at +y
  const headGeo = new THREE.ConeGeometry(0.05, 0.12, 8);
  headGeo.translate(0, 0.3, 0);     // head at the tip

  const SHAFT_MAT = new THREE.MeshStandardMaterial({
    color: 0x3a2a1a, roughness: 0.9,
  });
  const HEAD_MAT = new THREE.MeshStandardMaterial({
    color: 0x555555, roughness: 0.4, metalness: 0.6,
  });

  // arrow POOL: allocated up front, never per frame.
  // depthTest: false on the GLOW only — the big halo is meant to spill over
  // the drum body as firelight; the small flame sprite and the arrow meshes
  // keep depth testing.
  const pool = [];
  for (let i = 0; i < 40; i++) {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(shaftGeo, SHAFT_MAT);
    const head = new THREE.Mesh(headGeo, HEAD_MAT);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: flameTexture,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    flame.position.set(0, 0.3, 0);
    flame.scale.setScalar(0.45);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: flameTexture,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      opacity: 0.35,
    }));
    glow.position.set(0, 0.3, 0);
    glow.scale.setScalar(1.4);
    group.add(shaft, head, flame, glow);
    group.visible = false;
    scene.add(group);
    pool.push({
      group,
      flame,
      glow,
      active: false,
      laneIdx: -1,
      time: 0,
      spawn: new THREE.Vector3(),
      face: new THREE.Vector3(),
      hit: null,        // "HIT" | "NEAR" once judged
      hitAt: 0,         // audio-clock time the outcome effect last fired
      stuckUntil: 0,
    });
  }

  const activeNotes = [];   // entries currently in flight / stuck

  // drum visibility (per song part): hidden drums get no arrows and no ring
  const drumVisible = [true, true, true, true, true, true];
  const drumMeshes = [];
  const drumFade = [];
  for (let i = 0; i < 6; i++) {
    drumMeshes.push(scene.children.find((o) => o.isMesh && drumMat.includes(o.material)));
    drumFade.push({ active: false, started: 0 });
  }
  const FADE_S = 0.6;
  function setDrumVisible(laneIdx, visible) {
    if (laneIdx < 0 || laneIdx > 5) return;
    const mesh = drumMeshes[laneIdx];
    const mat = drumMat[laneIdx];
    const f = drumFade[laneIdx];
    if (visible === drumVisible[laneIdx]) return;
    drumVisible[laneIdx] = visible;
    if (visible) {
      f.active = true;
      f.started = performance.now();
      mesh.visible = true;
      mat.transparent = true;
      mat.opacity = 0;
      if (!f.arming) {
        f.arming = true;
        requestAnimationFrame(() => { f.arming = false; _fadeTick(); });
      }
    } else {
      f.active = false;
      mesh.visible = false;
      mat.transparent = false;
      mat.opacity = 1;
    }
  }

  // effect pools: allocated up front, reused forever, nothing per frame.
  // sparks: additive, drum-colour mixed with white, gravity, fade over 0.5 s
  const sparks = [];
  for (let i = 0; i < 200; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: flameTexture,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }));
    sp.visible = false;
    scene.add(sp);
    sparks.push({
      sprite: sp,
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      t0: 0,
      life: 0.5,
      scale0: 0.1,
    });
  }
  // smoke: normal blending, grey, rising, growing, fading over 0.5 s
  const smokes = [];
  for (let i = 0; i < 40; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: flameTexture,
      color: 0x888888,
      blending: THREE.NormalBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }));
    sp.visible = false;
    scene.add(sp);
    smokes.push({
      sprite: sp,
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      t0: 0,
      life: 0.5,
      scale0: 0.1,
    });
  }
  // smouldering (per stuck arrow): one dim flicker sprite + three puffs
  const smould = [];
  for (let i = 0; i < 12; i++) {
    const flicker = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: flameTexture,
      color: 0xff6a20,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }));
    flicker.visible = false;
    scene.add(flicker);
    const puffs = [];
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
        map: flameTexture,
        color: 0x777777,
        blending: THREE.NormalBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
      }));
      sp.visible = false;
      scene.add(sp);
      puffs.push({
        sprite: sp,
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        t0: 0,
        life: 0.5,
        scale0: 0.1,
      });
    }
    smould.push({ flicker, puffs, active: false, face: new THREE.Vector3() });
  }

  function freeSpark() {
    for (const s of sparks) if (!s.active) return s;
    return null;
  }

  // head normal: +y for floor drums, +z for upright drums
  function headNormal(laneIdx, out) {
    return laneIdx < 3 ? out.set(0, 0, 1) : out.set(0, 1, 0);
  }

  // outward direction at the face, biased along the head normal
  function outwardDir(laneIdx, out) {
    headNormal(laneIdx, out);
    if (Math.random() < 0.5) out.x += (Math.random() - 0.5) * 1.2;
    if (Math.random() < 0.5) out.z += (Math.random() - 0.5) * 1.2;
    out.y += (Math.random() - 0.5) * 0.6;
    out.normalize();
    return out;
  }

  function spawnBurst(laneIdx, heardNow, count, speedMin, speedMax, mixed) {
    headNormal(laneIdx, _eDir);
    for (let k = 0; k < count; k++) {
      const s = freeSpark();
      if (!s) break;
      s.active = true;
      s.t0 = heardNow; s.tPrev = heardNow;
      s.life = 0.5;
      s.scale0 = 0.06 + Math.random() * 0.06;
      _eDir.copy(outwardDir(laneIdx, _eDir));
      s.vel.copy(_eDir).multiplyScalar(speedMin + Math.random() * (speedMax - speedMin));
      s.pos.copy(drumFace[laneIdx]);
      s.pos.x += (Math.random() - 0.5) * 0.05;
      s.pos.y += (Math.random() - 0.5) * 0.05;
      s.pos.z += (Math.random() - 0.5) * 0.05;
      s.sprite.visible = true;
      s.sprite.position.copy(s.pos);
      s.sprite.scale.setScalar(s.scale0);
      if (mixed) {
        s.sprite.material.color.copy(_eWhite);
        if (Math.random() < 0.5) {
          s.sprite.material.color.copy(hexToColor(colors[drumOf(laneIdx)] || "#888888"));
        }
      }
    }
  }

  // glance-off: the arrow flies off the face along the head normal plus a
  // random sideways push at 4 m/s, spinning, fading over 0.4 s
  function spawnGlance(e, heardNow) {
    headNormal(e.laneIdx, _eVel);
    _eTang.set(0, 0, 1);
    if (Math.abs(_eVel.z) < 0.9) _eTang.set(1, 0, 0);
    _eSide.crossVectors(_eVel, _eTang).normalize();
    const push = 1.5 + Math.random() * 2.0;
    _eVel.multiplyScalar(4.0).addScaledVector(_eSide, (Math.random() - 0.5) * 2 * push);
    e.vel = _eVel;
    e.spin = (Math.random() - 0.5) * 12;
    e.t0 = heardNow; e.tPrev = heardNow;
    e.life = 0.4;
  }

  function spawnPuff(s, heardNow) {
    s.active = true;
    s.t0 = heardNow; s.tPrev = heardNow;
    s.life = 0.5;
    s.scale0 = 0.1;
    s.pos.set(0, 0, 0);
    s.vel.set(
      (Math.random() - 0.5) * 0.2,
      0.6,
      (Math.random() - 0.5) * 0.2,
    );
    s.sprite.visible = true;
  }

  function freeSmould() {
    for (const s of smould) if (!s.active) return s;
    return null;
  }

  // APPROACH RINGS + FIRELIGHT: one ring mesh and one glow sprite per drum,
  // allocated once. The ring closes onto the drum edge exactly at the arrow's
  // time — that closing moment is the hit moment. No per-frame allocation.
  const ringGeo = new THREE.RingGeometry(0.92, 1.0, 48);
  const rings = [];
  const firelights = [];
  for (let i = 0; i < 6; i++) {
    const lane = i < 3 ? layout.top[i] : layout.bottom[i - 3];
    const color = hexToColor(colors[lane.drum] || "#888888");
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const face = drumFace[i];
    if (i < 3) {
      // upright: facing the player, at the face (z = face + 0.01)
      ring.position.set(face.x, face.y, face.z + 0.01);
    } else {
      // floor: flat on the head (y = head + 0.01)
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(face.x, face.y + 0.01, face.z);
    }
    ring.visible = false;
    scene.add(ring);
    rings.push({ mesh: ring, radius: LANES3D[i].radius });

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: flameTexture,
      color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      opacity: 0,
    }));
    glow.position.copy(face);
    glow.scale.setScalar(2.2 * LANES3D[i].radius);
    glow.visible = false;
    scene.add(glow);
    firelights.push({ glow, radius: LANES3D[i].radius });
  }

  // path point p(f): lerp(spawn, face, f) + the parabolic arc lift.
  // Written into `out`; reuses module temps, allocates nothing.
  function pathPoint(e, f, out) {
    out.copy(e.spawn).lerp(e.face, f);
    out.y += ARC_LIFT[e.laneIdx] * 4 * f * (1 - f);
    return out;
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function findEntry(laneIdx, time) {
    for (const e of activeNotes) {
      if (e.laneIdx === laneIdx && Math.abs(e.time - time) < 1e-6) return e;
    }
    return null;
  }

  function recycle(e) {
    e.active = false;
    e.group.visible = false;
    const i = activeNotes.indexOf(e);
    if (i >= 0) activeNotes.splice(i, 1);
  }

  /**
   * Frame update.
   * @param {number} heardNow current audio-clock time (s)
   * @param {Array<{laneIdx: number, time: number}>} upcoming chart notes
   *   within the next APPROACH_S seconds (both rows)
   */
  function update(heardNow, upcoming) {
    // spawn / retire
    for (const u of upcoming) {
      if (!drumVisible[u.laneIdx]) continue;         // hidden drums get no arrows
      if (u.time - heardNow < -STUCK_S) continue;   // already expired
      let e = findEntry(u.laneIdx, u.time);
      if (!e) {
        e = pool.find((p) => !p.active);
        if (!e) continue;
        e.active = true;
        e.laneIdx = u.laneIdx;
        e.time = u.time;
        e.hit = null;
        e.hitAt = -1;
        e.stuckUntil = 0;
        e.group.visible = true;
        e.flame.material.color.copy(hexToColor(colors[drumOf(u.laneIdx)] || "#888888"));
        e.glow.material.color.copy(hexToColor(colors[drumOf(u.laneIdx)] || "#888888"));
        e.spawn.copy(SPAWNS[u.laneIdx]);
        e.face.copy(drumFace[u.laneIdx]);
        activeNotes.push(e);
      }
    }

    // position + flame flicker + retirement
    for (const e of activeNotes) {
      const dt = e.time - heardNow;
      if (dt < 0) {
        // past its time: a hit vanishes at once; otherwise sticks, then vanishes
        if (e.hit) {
          if (e.hitAt < 0) {
            e.hitAt = heardNow;
            if (e.hit === "HIT") {
              spawnBurst(e.laneIdx, heardNow, 24, 1.5, 4, true);
            } else {
              spawnGlance(e, heardNow);
              spawnBurst(e.laneIdx, heardNow, 6, 1.0, 2.0, false);
            }
          }
          if (e.hit === "HIT") {
            recycle(e);
            continue;
          }
          // NEAR: glance-off, flying away while fading over 0.4 s
          const g = (heardNow - e.hitAt) / e.life;
          if (g >= 1) {
            recycle(e);
            continue;
          }
          _ePos.copy(e.face).addScaledVector(e.vel, heardNow - e.hitAt);
          e.group.position.copy(_ePos);
          _eQ.setFromAxisAngle(_eAxis.set(Math.random() - 0.5, 1, Math.random() - 0.5), e.spin * (heardNow - e.hitAt));
          e.group.quaternion.copy(_eQ);
          const fade = 1 - g;
          e.flame.material.opacity = fade;
          e.glow.material.opacity = 0.35 * fade;
          continue;
        }
        if (heardNow > e.stuckUntil) {
          if (e.stuckUntil === 0) {
            // first frame past the time: arm the timer, park at the face
            e.stuckUntil = e.time + STUCK_S;
            e.group.position.copy(e.face);
            // backward difference: at f = 1 a forward step is zero-length
            pathPoint(e, 1, _pA);
            pathPoint(e, 0.99, _pB);
            _tan.copy(_pA).sub(_pB).normalize();
            e.group.quaternion.setFromUnitVectors(UP, _tan);
            // arm the smouldering at the head
            const sm = freeSmould();
            if (sm) {
              sm.active = true;
              sm.face.copy(e.face);
              sm.flicker.visible = true;
              sm.flicker.position.copy(e.face);
              sm.flicker.scale.setScalar(0.3);
              for (const p of sm.puffs) {
                spawnPuff(p, heardNow);
                p.pos.copy(e.face);
                p.pos.x += (Math.random() - 0.5) * 0.06;
                p.pos.z += (Math.random() - 0.5) * 0.06;
                p.sprite.position.copy(p.pos);
              }
            }
            continue;
          }
          // retiring: kill any smouldering this arrow armed
          for (const sm of smould) {
            if (sm.active && sm.face.equals(e.face)) {
              sm.active = false;
              sm.flicker.visible = false;
              sm.flicker.material.opacity = 0;
              for (const p of sm.puffs) {
                p.active = false;
                p.sprite.visible = false;
                p.sprite.material.opacity = 0;
              }
            }
          }
          recycle(e);
          continue;
        }
        // still stuck: smoulder flicker + smoke puffs
        for (const sm of smould) {
          if (sm.active && sm.face.equals(e.face)) {
            sm.flicker.material.opacity = 0.4 + 0.3 * Math.random();
            sm.flicker.scale.setScalar(0.3 * (0.9 + 0.2 * Math.random()));
            for (const p of sm.puffs) {
              if (!p.active && heardNow - p.t0 > p.life) {
                spawnPuff(p, heardNow);
                p.pos.copy(e.face);
                p.pos.x += (Math.random() - 0.5) * 0.06;
                p.pos.z += (Math.random() - 0.5) * 0.06;
                p.sprite.position.copy(p.pos);
              }
            }
          }
        }
        continue;
      }
      const f = 1 - dt / APPROACH_S;   // 0 at spawn, 1 at the face
      const clamped = Math.min(1, Math.max(0, f));
      pathPoint(e, clamped, _pB);
      e.group.position.copy(_pB);
      // orient along the path tangent: side-on, never a dot
      // backward difference, so a stuck arrow (clamped = 1) keeps its heading
      const f1 = Math.max(0, Math.min(clamped, 1) - 0.01);
      pathPoint(e, Math.max(clamped, 0.01), _pA);
      pathPoint(e, f1, _pB);
      _tan.copy(_pA).sub(_pB).normalize();
      e.group.quaternion.setFromUnitVectors(UP, _tan);
      // flame flicker
      const s = 0.45 * (0.9 + 0.2 * Math.random());
      e.flame.scale.setScalar(s);
      e.glow.scale.setScalar(1.4 * (0.9 + 0.2 * Math.random()));
    }

    // approach rings + firelight: the next unhit arrow per lane drives both.
    // Ring scale closes onto the drum edge exactly at dt = 0 (the hit moment).
    for (let lane = 0; lane < 6; lane++) {
      let next = null;
      for (const e of activeNotes) {
        if (e.laneIdx !== lane || e.hit) continue;
        const dt = e.time - heardNow;
        if (dt < 0 || dt > 1.0) continue;
        if (!next || dt < next.dt) next = { dt };
      }
      const r = rings[lane];
      const fl = firelights[lane];
      if (next && drumVisible[lane]) {
        const dt = next.dt;
        r.mesh.visible = true;
        r.mesh.scale.setScalar(r.radius * (1 + 1.4 * dt));
        r.mesh.material.opacity = 0.25 + 0.65 * (1 - dt);
        fl.glow.visible = true;
        fl.glow.material.opacity = 0.6 * (1 - dt);
      } else {
        r.mesh.visible = false;
        r.mesh.material.opacity = 0;
        fl.glow.visible = false;
        fl.glow.material.opacity = 0;
      }
    }

    // effect pools: sparks (gravity + fade), smoke (rise + grow + fade)
    for (const s of sparks) {
      if (!s.active) continue;
      const g = (heardNow - s.t0) / s.life;
      if (g >= 1) {
        s.active = false;
        s.sprite.visible = false;
        s.sprite.material.opacity = 0;
        continue;
      }
      // integrate by the slice since the LAST frame (using the total age here
      // re-applied the whole flight every frame and flung sparks off-screen)
      const sdt = Math.max(0, heardNow - (s.tPrev ?? s.t0)); s.tPrev = heardNow;
      s.vel.y -= 6 * sdt;
      s.pos.addScaledVector(s.vel, sdt);
      s.sprite.position.copy(s.pos);
      s.sprite.material.opacity = 1 - g;
    }
    for (const s of smokes) {
      if (!s.active) continue;
      const g = (heardNow - s.t0) / s.life;
      if (g >= 1) {
        s.active = false;
        s.sprite.visible = false;
        s.sprite.material.opacity = 0;
        continue;
      }
      const mdt = Math.max(0, heardNow - (s.tPrev ?? s.t0)); s.tPrev = heardNow;
      s.pos.addScaledVector(s.vel, mdt);
      s.sprite.position.copy(s.pos);
      s.sprite.material.opacity = 0.25 * (1 - g);
      s.sprite.scale.setScalar(0.1 + 0.4 * g);
    }
    // smouldering puffs recycle into the shared smoke pool
    for (const sm of smould) {
      if (!sm.active) continue;
      for (const p of sm.puffs) {
        if (!p.active) continue;
        const g = (heardNow - p.t0) / p.life;
        if (g >= 1) {
          p.active = false;
          p.sprite.visible = false;
          p.sprite.material.opacity = 0;
          continue;
        }
        const pdt = Math.max(0, heardNow - (p.tPrev ?? p.t0)); p.tPrev = heardNow;
        p.pos.addScaledVector(p.vel, pdt);
        p.sprite.position.copy(p.pos);
        p.sprite.material.opacity = 0.25 * (1 - g);
        p.sprite.scale.setScalar(0.1 + 0.4 * g);
      }
    }

    renderer.render(scene, camera);
  }

  /**
   * Mark the note (laneIdx, noteTime) as hit so its arrow plays its outcome.
   * The outcome fires the moment the arrow reaches its face (or immediately
   * if this call comes after that).
   * @param {"HIT"|"NEAR"} kind
   */
  function hit(laneIdx, noteTime, kind) {
    const e = findEntry(laneIdx, noteTime);
    if (e) e.hit = kind;
  }

  /**
   * Flash a drum's face: emissive to its colour at intensity 1.0 (HIT) or
   * 0.4, decaying to 0 over 150 ms.
   */
  function press(laneIdx, kind) {
    const mat = drumMat[laneIdx];
    if (!mat) return;
    mat.emissive.copy(hexToColor(colors[drumOf(laneIdx)] || "#888888"));
    mat.emissiveIntensity = kind === "HIT" ? 1.0 : 0.4;
    const started = performance.now();
    const tick = () => {
      const p = (performance.now() - started) / 150;
      if (p >= 1) {
        mat.emissiveIntensity = 0;
        return;
      }
      mat.emissiveIntensity = (kind === "HIT" ? 1.0 : 0.4) * (1 - p);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const _fadeTick = () => {
    let any = false;
    for (let i = 0; i < 6; i++) {
      const f = drumFade[i];
      if (!f.active) continue;
      any = true;
      const p = (performance.now() - f.started) / (FADE_S * 1000);
      const mat = drumMat[i];
      if (p >= 1) {
        f.active = false;
        mat.opacity = 1;
        mat.transparent = false;
      } else {
        mat.opacity = p;
      }
    }
    if (any) requestAnimationFrame(_fadeTick);
  };

  function drumOf(laneIdx) {
    return laneIdx < 3
      ? layout.top[laneIdx].drum
      : layout.bottom[laneIdx - 3].drum;
  }

  resize();
  return { resize, update, hit, press, setDrumVisible };
}
