/* stage3d.js — seated first-person 3D layout.
   Lanes 0-2 (layout.top): upright hand drums facing the player.
   Lanes 3-5 (layout.bottom): floor drums in front, heads facing up.
   Flaming billboard arrows fly in on the audio clock (the arrows ARE the
   notes), arcing in so they are always seen side-on. All effect lighting
   is fake: additive sprite flames and glows, no PointLights. */

import * as THREE from "three";

const APPROACH_S = 2.0;   // seconds of visible flight before a note's time
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

// arrow spawn points per lane
const SPAWNS = [
  new THREE.Vector3(-0.8 - 6, 2.0, -22),   // lane 0, side -1
  new THREE.Vector3(0.0 - 6, 2.0, -22),    // lane 1, side -1
  new THREE.Vector3(0.8 + 6, 2.0, -22),    // lane 2, side +1
  new THREE.Vector3(-0.75 * 1.6, 5.5, -24),
  new THREE.Vector3(0.0 * 1.6, 5.5, -24),
  new THREE.Vector3(0.75 * 1.6, 5.5, -24),
];

// arc height of the parabolic lift applied on top of the lerp:
// floor drums take the high arc dropping onto the head; uprights a lower arc.
const ARC_LIFT = [0.8, 0.8, 0.8, 3.0, 3.0, 3.0];

function hexToColor(s) {
  return new THREE.Color(s);   // accepts "#rrggbb"
}

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
  scene.fog = new THREE.FogExp2(0x05070d, 0.045);

  scene.add(new THREE.AmbientLight(0x404860, 0.6));
  const dir = new THREE.DirectionalLight(0x8090c0, 0.4);
  dir.position.set(2, 5, 6);
  scene.add(dir);

  const camera = new THREE.PerspectiveCamera(
    60, canvas.clientWidth / canvas.clientHeight, 0.1, 200,
  );
  camera.position.set(0, 1.15, 1.7);
  camera.lookAt(new THREE.Vector3(0, 0.6, -0.6));

  // ground: dark stone, flat at y = 0
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
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

  // arrow POOL: allocated up front, never per frame
  const pool = [];
  for (let i = 0; i < 40; i++) {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(shaftGeo, SHAFT_MAT);
    const head = new THREE.Mesh(headGeo, HEAD_MAT);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flameTexture,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    flame.position.set(0, 0.3, 0);
    flame.scale.setScalar(0.45);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flameTexture,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
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
      stuckUntil: 0,
    });
  }

  const activeNotes = [];   // entries currently in flight / stuck

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
      if (u.time - heardNow < -STUCK_S) continue;   // already expired
      let e = findEntry(u.laneIdx, u.time);
      if (!e) {
        e = pool.find((p) => !p.active);
        if (!e) continue;
        e.active = true;
        e.laneIdx = u.laneIdx;
        e.time = u.time;
        e.hit = null;
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
          recycle(e);
          continue;
        }
        if (heardNow > e.stuckUntil) {
          if (e.stuckUntil === 0) {
            // first frame past the time: arm the timer, park at the face
            e.stuckUntil = e.time + STUCK_S;
            e.group.position.copy(e.face);
            pathPoint(e, 1, _pB);
            pathPoint(e, Math.min(1, 1 + 0.01), _pA);
            _tan.copy(_pA).sub(_pB).normalize();
            e.group.quaternion.setFromUnitVectors(UP, _tan);
            continue;
          }
          recycle(e);
          continue;
        }
      }
      const f = 1 - dt / APPROACH_S;   // 0 at spawn, 1 at the face
      const clamped = Math.min(1, Math.max(0, f));
      pathPoint(e, clamped, _pB);
      e.group.position.copy(_pB);
      // orient along the path tangent: side-on, never a dot
      const f2 = Math.min(1, clamped + 0.01);
      pathPoint(e, clamped, _pB);
      pathPoint(e, f2, _pA);
      _tan.copy(_pA).sub(_pB).normalize();
      e.group.quaternion.setFromUnitVectors(UP, _tan);
      // flame flicker
      const s = 0.45 * (0.9 + 0.2 * Math.random());
      e.flame.scale.setScalar(s);
      e.glow.scale.setScalar(1.4 * (0.9 + 0.2 * Math.random()));
    }

    renderer.render(scene, camera);
  }

  /**
   * Mark the note (laneIdx, noteTime) as hit so its arrow vanishes at once.
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

  function drumOf(laneIdx) {
    return laneIdx < 3
      ? layout.top[laneIdx].drum
      : layout.bottom[laneIdx - 3].drum;
  }

  resize();
  return { resize, update, hit, press };
}
