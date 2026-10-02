/* stage3d.js — seated first-person 3D layout.
   Lanes 0-2 (layout.top): upright hand drums facing the player.
   Lanes 3-5 (layout.bottom): floor drums in front, heads facing up.
   Flaming billboard arrows fly in on the audio clock (the arrows ARE the
   notes), arcing in so they are always seen side-on. All effect lighting
   is fake: additive sprite flames and glows, no PointLights. */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

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
  renderer.shadowMap.enabled = true;                 // the foreground lantern casts shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(window.devicePixelRatio || 1);

  const scene = new THREE.Scene();

  // ---- TWILIGHT, just after sunset (owner's call) -------------------------
  // Sky dome: deep indigo overhead -> dusky violet -> a warm orange-pink glow
  // on the horizon, BEHIND the archers' wall (the -z direction). Kept dark
  // enough overhead that the flaming arrows still pop.
  const HORIZON_HAZE = 0x4a3a5c;
  scene.background = null;   // the sky dome is the background; a colour here would be repainted by the fx pass over the whole frame
  scene.fog = new THREE.FogExp2(HORIZON_HAZE, 0.011);   // fire ignores fog (fog:false on sprites)
  {
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        zenith:  { value: new THREE.Color(0x0e1434) },
        mid:     { value: new THREE.Color(0x3a2f62) },
        glow:    { value: new THREE.Color(0xf08a5a) },
        ground:  { value: new THREE.Color(0x1c1624) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 zenith, mid, glow, ground; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          // the afterglow is strongest toward the archers (-z) and hugs the horizon
          float toward = smoothstep(-0.2, 1.0, -vDir.z);
          float band = exp(-abs(h) * 9.0) * (0.35 + 0.65 * toward);
          vec3 c = h > 0.0 ? mix(mid, zenith, smoothstep(0.0, 0.55, h)) : ground;
          c = mix(c, glow, clamp(band, 0.0, 1.0) * 0.85);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMat);
    sky.renderOrder = -1;
    scene.add(sky);
  }

  // light: cool sky from above, warm bounce below, a low warm AFTERGLOW from the
  // horizon behind the archers that rims the drums, and the warm lantern close in
  scene.add(new THREE.HemisphereLight(0x6a78b8, 0x3a2a24, 0.75));
  scene.add(new THREE.AmbientLight(0x2a2440, 0.35));
  const afterglow = new THREE.DirectionalLight(0xff9a6a, 0.9);
  afterglow.position.set(-6, 3, -40);          // low, from the sunset side
  scene.add(afterglow);
  // the drum lantern: textured wood/leather needs a warm key light close in
  // the drum lantern: a warm SPOT just above and behind the player, aimed at the
  // drums, casting soft shadows (drums onto the ground, hands/sticks onto drums)
  const lantern = new THREE.SpotLight(0xffb36a, 26, 9, Math.PI / 4.2, 0.65, 1.4);
  lantern.position.set(0.35, 3.0, 1.9);
  lantern.target.position.set(0, 0.5, -0.8);
  lantern.castShadow = true;
  lantern.shadow.mapSize.set(2048, 2048);
  lantern.shadow.camera.near = 0.3;
  lantern.shadow.camera.far = 9;
  lantern.shadow.bias = -0.0004;
  lantern.shadow.normalBias = 0.02;
  lantern.shadow.radius = 4;
  scene.add(lantern, lantern.target);

  const camera = new THREE.PerspectiveCamera(
    60, canvas.clientWidth / canvas.clientHeight, 0.1, 200,
  );
  camera.position.set(0, 1.3, 2.0);
  camera.lookAt(new THREE.Vector3(0, 1.75, -10));   // horizon up: the far wall and the arcs are in view

  // AO for everything: GTAO (screen-space) between the scene render and output
  const FX_LAYER = 1;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, canvas.clientWidth || 1280, canvas.clientHeight || 720);
  gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16 });
  gtao.blendIntensity = 1.0;
  composer.addPass(gtao);
  // glowing effects (sprites, additive cards) render AFTER the AO in their own
  // pass: in the AO pass they showed as black squares (AO treated the cards as
  // solid). They live on layer 1; the main camera sees layer 0 only.
  const fxCamera = camera.clone();
  fxCamera.layers.set(FX_LAYER);
  const fxPass = new RenderPass(scene, fxCamera);
  fxPass.clear = false;
  fxPass.clearDepth = false;
  composer.addPass(fxPass);
  composer.addPass(new OutputPass());

  // ground: dark stone, flat at y = 0
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // drums
  const drumMat = [];
  const drumPos = [];
  const drumFace = [];
  const drumLabels = [];
  const drumLabelMats = [];
  const labelGeo = new THREE.PlaneGeometry(0.34, 0.34);
  const labelTex = (key) => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 128, 128);
    g.font = "bold 88px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.strokeStyle = "#1a0f08";
    g.lineWidth = 8;
    g.strokeText(key.toUpperCase(), 64, 64);
    g.fillStyle = "#f4e9d8";
    g.fillText(key.toUpperCase(), 64, 64);
    return new THREE.CanvasTexture(c);
  };
  for (let i = 0; i < 6; i++) {
    const lane = i < 3 ? layout.top[i] : layout.bottom[i - 3];
    const color = hexToColor(colors[lane.drum] || "#888888");
    const labelMat = new THREE.MeshBasicMaterial({
      map: labelTex(lane.key || "?"),
      transparent: true,
      depthWrite: false,
    });
    const label = new THREE.Mesh(labelGeo, labelMat);
    if (LANES3D[i].upright) {
      label.position.set(LANES3D[i].x, LANES3D[i].y, LANES3D[i].z + LANES3D[i].depth / 2 + 0.034);
    } else {
      label.rotation.x = -Math.PI / 2;   // flat on the head, readable from the seat
      label.position.set(LANES3D[i].x, LANES3D[i].y + LANES3D[i].depth / 2 + 0.034, LANES3D[i].z);
    }
    scene.add(label);
    drumLabels.push(label);
    drumLabelMats.push(labelMat);
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

  // FIRE texture: white-yellow core -> orange -> deep red edge, soft all the way
  const fireTexture = (() => {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0.00, "rgba(255,250,232,1)");
    grad.addColorStop(0.14, "rgba(255,222,130,0.95)");
    grad.addColorStop(0.34, "rgba(255,140,40,0.72)");
    grad.addColorStop(0.60, "rgba(210,48,12,0.30)");
    grad.addColorStop(1.00, "rgba(120,10,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const _fireA = new THREE.Color(1.0, 0.95, 0.75), _fireB = new THREE.Color(1.0, 0.5, 0.12),
        _fireC = new THREE.Color(0.55, 0.06, 0.02), _fc = new THREE.Color();
  // fire colour along a 0..1 "cooling" value: white-yellow -> orange -> deep red
  function fireColor(t, out) {
    return t < 0.5 ? out.copy(_fireA).lerp(_fireB, t * 2) : out.copy(_fireB).lerp(_fireC, (t - 0.5) * 2);
  }



  // shared arrow geometry (one allocation)
  const shaftGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6);
  shaftGeo.translate(0, -0.1, 0);   // shaft trails behind the head at +y
  const headGeo = new THREE.ConeGeometry(0.05, 0.12, 8);
  headGeo.translate(0, 0.3, 0);     // head at the tip

  // lit by their own flame: unlit warm colours, never swallowed by fog
  const SHAFT_MAT = new THREE.MeshBasicMaterial({ color: 0xb07840, fog: false });
  const HEAD_MAT = new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false });

  // arrow POOL: allocated up front, never per frame.
  // depthTest: false on the GLOW only — the big halo is meant to spill over
  // the drum body as firelight; the small flame sprite and the arrow meshes
  // keep depth testing.
  const _pT = new THREE.Vector3();
  const TRAIL_N = 12;          // fire puffs behind each arrow, along its own path
  const TRAIL_STEP = 0.0075;   // path fraction between puffs (~0.5 m)
  const pool = [];
  for (let i = 0; i < 40; i++) {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(shaftGeo, SHAFT_MAT);
    const head = new THREE.Mesh(headGeo, HEAD_MAT);
    shaft.castShadow = true; head.castShadow = true;
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: fireTexture,
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
      opacity: 0.42,
    }));
    glow.position.set(0, 0.3, 0);
    glow.scale.setScalar(1.4);
    group.add(shaft, head, flame, glow);
    group.visible = false;
    scene.add(group);
    const trail = [];
    for (let k = 0; k < TRAIL_N; k++) {
      const t = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, map: fireTexture,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      t.visible = false;
      scene.add(t);
      trail.push(t);
    }
    pool.push({
      group,
      flame,
      glow,
      trail,
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
    drumMeshes.push(scene.children.find((o) => o.isMesh && o.material === drumMat[i]));   // THIS drum's mesh (includes() matched drum 0 every time)
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
      drumLabels[laneIdx].visible = true;
      drumLabelMats[laneIdx].opacity = 0;
      if (!f.arming) {
        f.arming = true;
        requestAnimationFrame(() => { f.arming = false; _fadeTick(); });
      }
    } else {
      f.active = false;
      mesh.visible = false;
      drumLabels[laneIdx].visible = false;
      mat.transparent = false;
      mat.opacity = 1;
      drumLabelMats[laneIdx].opacity = 1;
    }
  }

  // ---- player hands + taiko sticks (procedural placeholders; the owner
  //      swaps in his own models later — each hand+stick stays in one Group
  //      per hand so it can be replaced wholesale). Pooled: built once, reused.
  const STICK_LEN = 0.42;
  const handGeo = new THREE.SphereGeometry(0.1, 20, 14);   // big enough to read as a fist
  handGeo.scale(1, 0.8, 1.3);   // slightly squashed fist
  const stickGeo = new THREE.CylinderGeometry(0.022, 0.026, STICK_LEN, 10);
  stickGeo.translate(0, STICK_LEN / 2, 0);   // fist at origin, tip at +y
  // warm and partly self-lit, like the arrows: dark-brown hands vanished in the night scene
  const handMat = new THREE.MeshStandardMaterial({ color: 0x7e5a46, roughness: 0.8, metalness: 0.05,
    emissive: 0x8a5034, emissiveIntensity: 0.08 });   // the lantern lights them now
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 0.6, metalness: 0.05,
    emissive: 0x9a7040, emissiveIntensity: 0.1 });

  // rest poses: widened and lowered so the fists never sit on a drum on
  // screen (a fist at y 0.95 would occlude the upright drums' heads)
  // in the bottom CORNERS of the view: visible, and outside every drum on screen
  // (at y 0.74 they were off-screen; the bottom edge at z 1.35 is ~y 0.95)
  const HAND_REST = [
    new THREE.Vector3(-0.55, 1.0, 1.35),
    new THREE.Vector3(0.55, 1.0, 1.35),
  ];
  // rest stick heading: up-forward ~35° from vertical (toward the drums)
  const REST_DIR = new THREE.Vector3(0, Math.cos(35 * Math.PI / 180), -Math.sin(35 * Math.PI / 180));

  const hands = [];
  for (let h = 0; h < 2; h++) {
    const group = new THREE.Group();
    const fist = new THREE.Mesh(handGeo, handMat);
    const stick = new THREE.Mesh(stickGeo, stickMat);
    fist.castShadow = true; stick.castShadow = true;
    group.add(fist, stick);
    group.position.copy(HAND_REST[h]);
    group.quaternion.setFromUnitVectors(UP, REST_DIR);
    scene.add(group);
    hands.push({
      group,
      active: false,
      dir: new THREE.Vector3().copy(REST_DIR),
      impact: new THREE.Vector3().copy(HAND_REST[h]),
      rest: new THREE.Vector3().copy(HAND_REST[h]),
      startDir: new THREE.Vector3().copy(REST_DIR),
      startPos: new THREE.Vector3().copy(HAND_REST[h]),
      t0: 0,
      last: 0,
    });
  }
  const _hDir = new THREE.Vector3();
  const _hPos = new THREE.Vector3();

  const FLASH_MS = 80;
  const REBOUND_MS = 180;

  // which hand plays a lane: outer lanes fixed, middle lanes alternate
  // like a drummer (whichever hand struck LESS recently)
  function handFor(laneIdx) {
    if (laneIdx === 0 || laneIdx === 3) return 0;
    if (laneIdx === 2 || laneIdx === 5) return 1;
    return hands[0].last <= hands[1].last ? 0 : 1;
  }

  /**
   * Strike a lane with the player's hand: the hand is AT the impact pose on
   * the very next frame (the sound plays at the press), then rebounds to
   * rest over 180 ms with an upward overshoot. A new strike on the same
   * hand interrupts the recoil and snaps to the new impact.
   * @param {number} laneIdx 0-5
   * @param {"HIT"|"NEAR"|string} kind "HIT" fires a short bright tip flash
   */
  function strike(laneIdx, kind) {
    if (laneIdx < 0 || laneIdx > 5) return;
    const h = handFor(laneIdx);
    const hand = hands[h];
    const face = drumFace[laneIdx];
    // stick points from the fist to the face; the fist sits STICK_LEN back
    // along that line so the tip lands on the face/head
    _hDir.copy(face).sub(hand.group.position).normalize();
    hand.impact.copy(face).addScaledVector(_hDir, -STICK_LEN);
    hand.dir.copy(_hDir);
    hand.group.position.copy(hand.impact);
    hand.group.quaternion.setFromUnitVectors(UP, hand.dir);
    hand.startPos.copy(hand.impact);
    hand.startDir.copy(hand.dir);
    hand.active = true;
    hand.t0 = performance.now();
    hand.last = performance.now();
    if (kind === "HIT") {
      hand.group.add(hand.flash);
      hand.flash.position.set(0, STICK_LEN, 0);
      hand.flashT0 = performance.now();
      hand.flash.visible = true;
      hand.flash.material.opacity = 1;
    }
  }

  // ---- GHOST HANDS: the player's OWN hands, ghosted --------------------------
  // Same fist + stick geometry, same sizes, same impact maths as strike(); only
  // the material differs (Fresnel ghost in the drum's colour). One per lane, so
  // overlapping loop hits never steal each other's hand. The loop's hit time is
  // known ahead, so a ghost winds up 0.15 s before it lands EXACTLY on time.
  const GHOST_WIND = 0.15, GHOST_RECOIL = REBOUND_MS / 1000, GHOST_OPACITY = 0.7;
  function ghostMaterial(color) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color.clone() }, uOpacity: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
          gl_FragColor = vec4(uColor * (0.35 + 1.8 * f), uOpacity * (0.18 + 0.82 * f)); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }
  const GHOST_SIDE = [0, 0, 1, 0, 1, 1];   // left: hat, snare, kick; right: crash, low tom, high tom
  const ghostHands = [];
  for (let i = 0; i < 6; i++) {
    const mat = ghostMaterial(hexToColor(colors[drumOf(i)] || "#888888"));
    const group = new THREE.Group();
    group.add(new THREE.Mesh(handGeo, mat), new THREE.Mesh(stickGeo, mat));
    group.visible = false;
    scene.add(group);
    const rest = HAND_REST[GHOST_SIDE[i]].clone().add(new THREE.Vector3(0, 0.08, -0.12));
    // impact pose, computed once exactly like strike(): stick from rest toward the face
    const dir = drumFace[i].clone().sub(rest).normalize();
    const impact = drumFace[i].clone().addScaledVector(dir, -STICK_LEN);
    ghostHands.push({ group, mat, rest, dir, impact, pulsedAt: -1 });
  }
  const _gDir = new THREE.Vector3(), _gPos = new THREE.Vector3();
  const WIND_DIR = REST_DIR.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.6);   // tipped back

  function updateGhostHands(heardNow, ghosts) {
    for (let i = 0; i < 6; i++) {
      const g = ghostHands[i];
      // the hit this ghost is working on: the soonest one not yet fully recoiled
      let T = Infinity, vel = 1;
      for (const h of ghosts) {
        if (h.laneIdx !== i) continue;
        if (h.time + GHOST_RECOIL < heardNow) continue;
        if (h.time < T) { T = h.time; vel = h.velocity; }
      }
      const into = heardNow - (T - GHOST_WIND);
      if (!isFinite(T) || into < 0 || !drumVisible[i]) { g.group.visible = false; continue; }
      g.group.visible = true;
      if (heardNow < T) {
        // wind-up: from rest, rising and tipping back (bigger for louder notes)
        const e = into / GHOST_WIND;
        _gPos.copy(g.rest); _gPos.y += 0.22 * vel * e;
        g.group.position.copy(_gPos);
        _gDir.copy(REST_DIR).lerp(WIND_DIR, e * vel).normalize();
        g.group.quaternion.setFromUnitVectors(UP, _gDir);
        g.mat.uniforms.uOpacity.value = GHOST_OPACITY * e;
      } else {
        // impact at T, then the same recoil as the player's hands
        const p = Math.min(1, (heardNow - T) / GHOST_RECOIL);
        const e = 1 - (1 - p) * (1 - p);
        _gPos.copy(g.impact).lerp(g.rest, e);
        _gPos.y += 0.16 * Math.sin(Math.PI * e);
        g.group.position.copy(_gPos);
        _gDir.copy(g.dir).lerp(REST_DIR, e).normalize();
        g.group.quaternion.setFromUnitVectors(UP, _gDir);
        g.mat.uniforms.uOpacity.value = GHOST_OPACITY * (1 - 0.7 * e);
        if (g.pulsedAt !== T) {   // the drum answers the ghost's hit, softly
          g.pulsedAt = T;
          const dm = drumMat[i];
          if (dm && dm.emissive) {
            dm.emissive.copy(hexToColor(colors[drumOf(i)] || "#888888"));
            dm.emissiveIntensity = Math.max(dm.emissiveIntensity || 0, 0.3 * vel);
            const t0 = performance.now();
            const tick = () => { const q = (performance.now() - t0) / 150;
              if (q >= 1) { dm.emissiveIntensity = 0; return; }
              dm.emissiveIntensity = Math.min(dm.emissiveIntensity, 0.3 * vel * (1 - q)); requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
          }
        }
      }
    }
  }

  function updateHands(now) {
    for (const hand of hands) {
      if (!hand.active) continue;
      const t = now - hand.t0;
      if (t >= REBOUND_MS) {
        hand.active = false;
        hand.group.position.copy(hand.rest);
        hand.group.quaternion.setFromUnitVectors(UP, REST_DIR);
      } else {
        const p = Math.min(1, t / REBOUND_MS);
        const e = 1 - (1 - p) * (1 - p);   // ease-out
        const overshoot = 0.16 * Math.sin(Math.PI * e);   // slight upward rebound
        _hPos.copy(hand.startPos).lerp(hand.rest, e);
        _hPos.y += overshoot;
        hand.group.position.copy(_hPos);
        _hDir.copy(hand.startDir).lerp(REST_DIR, e);
        hand.group.quaternion.setFromUnitVectors(UP, _hDir.normalize());
      }
      if (hand.flash && hand.flash.visible) {
        const f = (now - hand.flashT0) / FLASH_MS;
        if (f >= 1) {
          hand.flash.visible = false;
          hand.flash.material.opacity = 0;
          hand.group.remove(hand.flash);
        } else {
          hand.flash.material.opacity = 1 - f;
        }
      }
    }
  }

  const flashMat = new THREE.SpriteMaterial({ fog: false,
    map: fireTexture,
    color: 0xffffff,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    opacity: 0,
  });
  for (const hand of hands) {
    const flash = new THREE.Sprite(flashMat);
    flash.position.set(0, STICK_LEN, 0);
    flash.scale.setScalar(0.22);
    flash.visible = false;
    hand.flash = flash;
  }

  // effect pools: allocated up front, reused forever, nothing per frame.
  // sparks: additive, drum-colour mixed with white, gravity, fade over 0.5 s
  const sparks = [];
  for (let i = 0; i < 400; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: fireTexture,
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
      map: fireTexture,
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

  // EXPLOSION (perfect block only): flash, shockwave ring, blast streaks,
  // splinters, embers. Every pool allocated up front; nothing per frame.
  const flashes = [];
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: fireTexture,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }));
    sp.visible = false;
    scene.add(sp);
    flashes.push({ sprite: sp, active: false, t0: 0, color: new THREE.Color() });
  }

  const shockGeo = new THREE.RingGeometry(1.0, 1.08, 48);
  const shockwaves = [];
  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    mesh.visible = false;
    scene.add(mesh);
    shockwaves.push({ mesh, active: false, t0: 0, laneIdx: -1, r0: 0.3, color: new THREE.Color() });
  }

  const streakGeo = new THREE.PlaneGeometry(1, 1);
  const streaks = [];
  for (let i = 0; i < 24; i++) {
    const mesh = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({
      color: 0xffd090,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    mesh.visible = false;
    scene.add(mesh);
    streaks.push({
      mesh, active: false,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      t0: 0, tPrev: 0, life: 0.7, speed: 0,
    });
  }

  const splinterGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 6);   // shaft geometry at 0.25 length
  const splinters = [];
  for (let i = 0; i < 48; i++) {
    const mesh = new THREE.Mesh(splinterGeo, SHAFT_MAT);
    mesh.visible = false;
    scene.add(mesh);
    splinters.push({
      mesh, active: false,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      spin: new THREE.Vector3(), t0: 0, tPrev: 0,
    });
  }
  const tumblers = [];
  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.Mesh(headGeo, HEAD_MAT);
    mesh.visible = false;
    scene.add(mesh);
    tumblers.push({
      mesh, active: true === false,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      spin: new THREE.Vector3(), t0: 0, tPrev: 0,
    });
  }

  const embers = [];
  for (let i = 0; i < 120; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: fireTexture,
      color: 0xff9a40,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }));
    sp.visible = false;
    scene.add(sp);
    embers.push({
      sprite: sp, active: false,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      t0: 0, life: 1.5,
    });
  }

  function freeStreak() {
    for (const s of streaks) if (!s.active) return s;
    return null;
  }

  // perfect block: the strike detonates at the drum face.
  function explode(laneIdx, heardNow, power = 1) {
    const P = 0.35 + 0.65 * Math.max(0, Math.min(1, power));   // dead-on = full blast
    const face = drumFace[laneIdx];
    const drumColor = hexToColor(colors[drumOf(laneIdx)] || "#888888");

    // 1. FLASH — white-hot core tinted by the drum colour,
    //    scale 0 -> 1.8 m over 60 ms, then fade over 180 ms.
    let fl = null;
    for (const f of flashes) if (!f.active) { fl = f; break; }
    if (fl) {
      fl.active = true;
      fl.t0 = heardNow;
      fl.color.copy(_eWhite).lerp(drumColor, 0.35);
      fl.sprite.material.color.copy(fl.color);
      fl.sprite.position.copy(face);
      fl.sprite.visible = true;
      fl.power = P;
    }

    // 2. SHOCKWAVE — thin additive ring on the drumhead plane,
    //    radius r0 -> 3*r0 over 300 ms, opacity 1 -> 0.
    let sw = null;
    for (const w of shockwaves) if (!w.active) { sw = w; break; }
    if (sw) {
      sw.active = true;
      sw.t0 = heardNow;
      sw.laneIdx = laneIdx;
      sw.r0 = LANES3D[laneIdx].radius;
      sw.color.copy(_eWhite).lerp(drumColor, 0.25);
      sw.mesh.material.color.copy(sw.color);
      sw.mesh.position.copy(face);
      if (laneIdx >= 3) sw.mesh.rotation.set(-Math.PI / 2, 0, 0);   // flat on floor heads
      else sw.mesh.rotation.set(0, 0, 0);                            // facing the player on upright
      sw.mesh.visible = true;
      sw.power = P;
    }

    // 3. BLAST SPARKS — 60, speeds 4-9 m/s, mostly along the head normal
    //    in a wide cone, gravity, fading over 0.7 s.
    headNormal(laneIdx, _eDir);
    for (let k = 0; k < Math.round(60 * P); k++) {
      const s = freeSpark();
      if (!s) break;
      s.active = true;
      s.t0 = heardNow; s.tPrev = heardNow;
      s.life = 0.7;
      s.scale0 = 0.08 + Math.random() * 0.08;
      _eTang.set(0, 0, 1);
      if (Math.abs(_eDir.z) < 0.9) _eTang.set(1, 0, 0);
      _eSide.crossVectors(_eDir, _eTang).normalize();
      const spread = (Math.random() - 0.5) * 1.1;
      _eVel.copy(_eDir).addScaledVector(_eSide, spread).addScaledVector(_eTang, (Math.random() - 0.5) * 1.1);
      _eVel.normalize();
      s.vel.copy(_eVel).multiplyScalar(4 + Math.random() * 5);
      s.pos.copy(face);
      s.pos.x += (Math.random() - 0.5) * 0.05;
      s.pos.y += (Math.random() - 0.5) * 0.05;
      s.pos.z += (Math.random() - 0.5) * 0.05;
      s.sprite.visible = true;
      s.sprite.position.copy(s.pos);
      s.sprite.scale.setScalar(s.scale0);
      s.sprite.material.color.copy(_eWhite);
      if (Math.random() < 0.5) s.sprite.material.color.copy(drumColor);
    }

    // a third leave short streaks: stretched sprites rotated to the
    // screen-space velocity direction, brighter than plain sparks.
    for (let k = 0; k < Math.round(20 * P); k++) {
      const st = freeStreak();
      if (!st) break;
      st.active = true;
      st.t0 = heardNow; st.tPrev = heardNow;
      st.life = 0.7;
      _eTang.set(0, 0, 1);
      if (Math.abs(_eDir.z) < 0.9) _eTang.set(1, 0, 0);
      _eSide.crossVectors(_eDir, _eTang).normalize();
      _eVel.copy(_eDir).addScaledVector(_eSide, (Math.random() - 0.5) * 1.1).addScaledVector(_eTang, (Math.random() - 0.5) * 1.1);
      _eVel.normalize();
      st.speed = 4 + Math.random() * 5;
      st.vel.copy(_eVel).multiplyScalar(st.speed);
      st.pos.copy(face);
      st.pos.x += (Math.random() - 0.5) * 0.05;
      st.pos.y += (Math.random() - 0.5) * 0.05;
      st.pos.z += (Math.random() - 0.5) * 0.05;
      st.mesh.visible = true;
    }

    // 4. SPLINTERS — the arrow shatters: 6 short shaft pieces spinning out
    //    at 3-6 m/s, gone after 0.8 s; plus the arrowhead tumbling away.
    for (let k = 0; k < 6; k++) {
      let sp2 = null;
      for (const x of splinters) if (!x.active) { sp2 = x; break; }
      if (!sp2) break;
      sp2.active = true;
      sp2.t0 = heardNow; sp2.tPrev = heardNow;
      _eVel.copy(headNormal(laneIdx, _eVel));
      _eVel.x += (Math.random() - 0.5) * 1.6;
      _eVel.y += (Math.random() - 0.5) * 1.6;
      _eVel.z += (Math.random() - 0.5) * 1.6;
      _eVel.normalize();
      sp2.vel.copy(_eVel).multiplyScalar(3 + Math.random() * 3);
      sp2.pos.copy(face);
      sp2.pos.x += (Math.random() - 0.5) * 0.08;
      sp2.pos.y += (Math.random() - 0.5) * 0.08;
      sp2.pos.z += (Math.random() - 0.5) * 0.08;
      sp2.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(24);
      sp2.mesh.visible = true;
      sp2.mesh.position.copy(sp2.pos);
    }
    for (const tb of tumblers) {
      if (tb.active) continue;
      tb.active = true;
      tb.t0 = heardNow; tb.tPrev = heardNow;
      _eVel.copy(headNormal(laneIdx, _eVel));
      _eVel.x += (Math.random() - 0.5) * 1.6;
      _eVel.y += (Math.random() - 0.5) * 1.6;
      _eVel.z += (Math.random() - 0.5) * 1.6;
      _eVel.normalize();
      tb.vel.copy(_eVel).multiplyScalar(3 + Math.random() * 3);
      tb.pos.copy(face);
      tb.pos.x += (Math.random() - 0.5) * 0.08;
      tb.pos.y += (Math.random() - 0.5) * 0.08;
      tb.pos.z += (Math.random() - 0.5) * 0.08;
      tb.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(28);
      tb.mesh.visible = true;
      tb.mesh.position.copy(tb.pos);
      break;   // one arrowhead per explosion
    }

    // 5. EMBERS — 20 slow glowing afterglow particles drifting up, fading over 1.5 s.
    for (let k = 0; k < 20; k++) {
      let em = null;
      for (const x of embers) if (!x.active) { em = x; break; }
      if (!em) break;
      em.active = true;
      em.t0 = heardNow; em.tPrev = heardNow;
      em.life = 1.5;
      em.vel.set((Math.random() - 0.5) * 0.2, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 0.2);
      em.pos.copy(face);
      em.pos.x += (Math.random() - 0.5) * 0.1;
      em.pos.y += (Math.random() - 0.5) * 0.1;
      em.pos.z += (Math.random() - 0.5) * 0.1;
      em.sprite.visible = true;
      em.sprite.position.copy(em.pos);
      em.sprite.scale.setScalar(0.05 + Math.random() * 0.04);
    }
  }

  // APPROACH RINGS + FIRELIGHT: one ring mesh and one glow sprite per drum,
  // allocated once. The ring closes onto the drum edge exactly at the arrow's
  // time — that closing moment is the hit moment. No per-frame allocation.
  const ringGeo = new THREE.RingGeometry(0.92, 1.0, 48);
  const rings = [];
  const _mc = new THREE.Color(), _white = new THREE.Color(0xffffff);
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
    firelights.push({ glow, radius: LANES3D[i].radius, base: hexToColor(colors[drumOf(i)] || "#888888").clone() });
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
    if (composer) { composer.setSize(w, h); gtao.setSize(w, h); }
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
    for (const t of e.trail) t.visible = false;
    const i = activeNotes.indexOf(e);
    if (i >= 0) activeNotes.splice(i, 1);
  }

  /**
   * Frame update.
   * @param {number} heardNow current audio-clock time (s)
   * @param {Array<{laneIdx: number, time: number}>} upcoming chart notes
   *   within the next APPROACH_S seconds (both rows)
   */
  // ---- DECOY VOLLEYS: more fire in the sky, not all of it for you -----------
  // Arrows that never target a drum: they lob in from all across the far wall
  // and thud into the courtyard ground around the player, then burn out. They
  // carry NO lane halo, no charge light, no timing — only playable arrows do,
  // so the player can always tell which arrows are theirs.
  const DECOY_N = 36, DECOY_TRAIL = 8;
  const decoys = [];
  for (let i = 0; i < DECOY_N; i++) {
    const group = new THREE.Group();
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, map: fireTexture,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    flame.position.set(0, 0.3, 0);
    group.add(new THREE.Mesh(shaftGeo, SHAFT_MAT), new THREE.Mesh(headGeo, HEAD_MAT), flame);
    group.visible = false;
    scene.add(group);
    const trail = [];
    for (let k = 0; k < DECOY_TRAIL; k++) {
      const t = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, map: fireTexture,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      t.visible = false; scene.add(t); trail.push(t);
    }
    decoys.push({ group, flame, trail, active: false, t0: 0, dur: 3, arc: 6,
      from: new THREE.Vector3(), to: new THREE.Vector3(), landed: -1 });
  }
  let nextVolley = -1;
  const _dP = new THREE.Vector3(), _dQ = new THREE.Vector3(), _dT = new THREE.Vector3();
  function decoyPoint(d, f, out) {
    out.copy(d.from).lerp(d.to, f);
    out.y += d.arc * 4 * f * (1 - f);
    return out;
  }
  function launchDecoy(heardNow) {
    const d = decoys.find((x) => !x.active);
    if (!d) return;
    d.active = true; d.t0 = heardNow; d.landed = -1;
    d.dur = 2.4 + Math.random() * 1.0;
    d.arc = 5 + Math.random() * 6;
    d.from.set(-40 + Math.random() * 80, 2.5 + Math.random() * 1.5, -70 + Math.random() * 20);
    // a ground spot around the player — never the drum area or the player
    for (let tries = 0; tries < 20; tries++) {
      d.to.set(-7 + Math.random() * 14, 0, -14 + Math.random() * 16.5);
      const nearDrums = Math.abs(d.to.x) < 1.6 && d.to.z > -2.4 && d.to.z < 2.6;
      if (!nearDrums) break;
    }
    d.group.visible = true;
    d.flame.material.opacity = 1;
  }
  function updateDecoys(heardNow) {
    if (heardNow <= 0) return;
    if (nextVolley < 0) nextVolley = heardNow + 0.8;
    if (heardNow >= nextVolley) {
      const n = 1 + Math.floor(Math.random() * 4);           // volleys of 1-4
      for (let k = 0; k < n; k++) launchDecoy(heardNow - k * 0.09);
      nextVolley = heardNow + 0.6 + Math.random() * 1.0;
    }
    for (const d of decoys) {
      if (!d.active) continue;
      const f = (heardNow - d.t0) / d.dur;
      if (f < 1) {
        decoyPoint(d, Math.max(0, f), _dP);
        decoyPoint(d, Math.max(0, f - 0.01), _dQ);
        d.group.position.copy(_dP);
        d.group.quaternion.setFromUnitVectors(UP, _dT.copy(_dP).sub(_dQ).normalize());
        const far = Math.max(1, _dP.distanceTo(camera.position) / 5);
        const s = 0.4 * Math.min(far, 5) * (0.9 + 0.2 * Math.random());
        d.flame.scale.setScalar(s);
        for (let k = 0; k < DECOY_TRAIL; k++) {
          const t = d.trail[k];
          const fk = f - (k + 1) * 0.0075;
          if (fk <= 0) { t.visible = false; continue; }
          t.position.copy(decoyPoint(d, fk, _dT));
          const cool = (k + 1) / DECOY_TRAIL;
          t.scale.setScalar(s * 0.9 * (1 - 0.75 * cool));
          fireColor(0.15 + 0.85 * cool, _fc);
          t.material.color.copy(_fc);
          t.material.opacity = 0.75 * Math.pow(1 - cool, 1.3);
          t.visible = true;
        }
      } else {
        // stuck in the ground, burning out over 1.2 s
        if (d.landed < 0) {
          d.landed = heardNow;
          for (const t of d.trail) t.visible = false;
          d.group.position.copy(d.to);          // head buried at the landing spot
        }
        const b = (heardNow - d.landed) / 1.2;
        if (b >= 1) { d.active = false; d.group.visible = false; continue; }
        d.flame.material.opacity = (1 - b) * (0.7 + 0.3 * Math.random());
        d.flame.scale.setScalar(0.35 * (1 - 0.6 * b));
      }
    }
  }

  let _frameNo = 0;
  let fxSorted = false, fxCount = -1;
  function sortFx() {
    let n = 0;
    scene.traverse((o) => {
      const m = o.material;
      const glowy = o.isSprite || (m && !Array.isArray(m) && m.blending === THREE.AdditiveBlending);
      if (glowy) { o.layers.set(FX_LAYER); n++; }
    });
    if (n === fxCount) fxSorted = true;   // stable two frames in a row: done
    fxCount = n;
  }
  function update(heardNow, upcoming, ghosts = []) {
    updateGhostHands(heardNow, ghosts);
    updateDecoys(heardNow);
    _frameNo++;
    updateHands(performance.now());
    // spawn / retire
    for (const u of upcoming) {
      if (!drumVisible[u.laneIdx]) continue;         // hidden drums get no arrows
      if (u.time - heardNow < -STUCK_S) continue;   // already expired
      let e = findEntry(u.laneIdx, u.time);
      if (e) e.seen = _frameNo;
      // only a note still IN FLIGHT may get a new arrow: a blocked arrow is
      // recycled at impact, and re-spawning it here (its note is still listed
      // for STUCK_S) made a ghost arrow stick in the drum after every block
      if (!e && u.time <= heardNow) continue;
      if (!e) {
        e = pool.find((p) => !p.active);
        if (!e) continue;
        e.active = true;
        e.laneIdx = u.laneIdx;
        e.time = u.time;
        e.seen = _frameNo;
        e.hit = null;
        e.hitAt = -1;
        e.stuckUntil = 0;
        e.group.visible = true;
        e.flame.material.color.setRGB(1, 1, 1);   // the fire texture carries the colour
        e.flame.material.opacity = 1;              // a recycled glance left these faded
        e.glow.material.opacity = 0.42;
        e.glow.material.color.copy(hexToColor(colors[drumOf(u.laneIdx)] || "#888888"));
        e.spawn.copy(SPAWNS[u.laneIdx]);
        e.face.copy(drumFace[u.laneIdx]);
        activeNotes.push(e);
      }
    }

    // an arrow still in flight whose note is no longer wanted (the part just
    // locked into a loop) leaves quietly instead of sticking in the drum
    for (let i = activeNotes.length - 1; i >= 0; i--) {   // backwards: recycle() splices
      const e = activeNotes[i];
      if (e.time > heardNow && e.seen !== _frameNo && !e.hit) recycle(e);
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
              explode(e.laneIdx, heardNow, e.power ?? 1);
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
          for (const t of e.trail) t.visible = false;   // no frozen trail left hanging
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
      // grow with distance so a far arrow is still a clear burning point,
      // not a speck that seems to fade out (screen size ~constant beyond 5 m)
      const far = Math.max(1, e.group.position.distanceTo(camera.position) / 5);
      // flame core keeps a readable size far away; the halo grows only a little,
      // so distant arrows are sharp points of fire, not blobs
      const s = 0.45 * Math.min(far, 5) * (0.9 + 0.2 * Math.random());
      e.flame.scale.setScalar(s);
      e.glow.scale.setScalar(1.4 * Math.min(far, 1.8) * (0.9 + 0.2 * Math.random()));
      // FIRE TRAIL: puffs along the arrow's own path just behind it, shrinking,
      // cooling orange -> deep red and fading — smooth because it IS the path
      for (let k = 0; k < TRAIL_N; k++) {
        const t = e.trail[k];
        const fk = clamped - (k + 1) * TRAIL_STEP;
        if (dt < 0 || fk <= 0) { t.visible = false; continue; }
        pathPoint(e, fk, _pT);
        t.position.copy(_pT);
        const cool = (k + 1) / TRAIL_N;
        t.scale.setScalar(s * 0.95 * (1 - 0.75 * cool));
        fireColor(0.15 + 0.85 * cool, _fc);
        t.material.color.copy(_fc);
        t.material.opacity = 0.85 * Math.pow(1 - cool, 1.3);
        t.visible = true;
      }
    }

    // MAGIC CHARGE (owner's design, replaces the shrinking ring): the drumhead
    // light fades in as the arrow comes, accelerating, and is BRIGHTEST —
    // whitening and flashing — exactly at the hit time, then drops in 0.12 s.
    // Hit at the peak = the magic at full strength = the arrow explodes.
    for (let lane = 0; lane < 6; lane++) {
      let next = null;
      for (const e of activeNotes) {
        if (e.laneIdx !== lane || e.hit) continue;
        const dt = e.time - heardNow;
        if (dt < -0.12 || dt > 1.2) continue;
        if (!next || Math.abs(dt) < Math.abs(next.dt)) next = { dt };
      }
      const r = rings[lane];
      const fl = firelights[lane];
      r.mesh.visible = false;
      if (next && drumVisible[lane]) {
        const dt = next.dt;
        // charge 0..1: cubic so the brightening is fastest right before the beat
        const c = dt >= 0 ? Math.pow(1 - dt / 1.2, 3) : Math.max(0, 1 + dt / 0.12);
        const peak = Math.abs(dt) < 0.025 ? 1 : 0;              // the flash AT the beat
        fl.glow.visible = true;
        fl.glow.material.opacity = Math.min(1, 0.08 + 0.85 * c + 0.25 * peak);
        fl.glow.scale.setScalar(fl.radius * 2.6 * (0.75 + 0.45 * c + 0.3 * peak));
        _mc.copy(fl.base).lerp(_white, 0.55 * c * c + 0.3 * peak);   // white-hot at the peak
        fl.glow.material.color.copy(_mc);
      } else {
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
      // burn like fire: white-yellow -> orange -> deep red, shrinking as it cools
      fireColor(g, _fc);
      s.sprite.material.color.copy(_fc);
      s.sprite.scale.setScalar(s.scale0 * (1 - 0.6 * g));
      s.sprite.material.opacity = Math.pow(1 - g, 1.2);
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

    // FLASH / SHOCKWAVE / STREAKS / EMBERS — these were spawned but never
    // animated (opacity stayed 0: invisible, frozen, pools ran dry)
    for (const f of flashes) {
      if (!f.active) continue;
      const t = heardNow - f.t0;
      if (t >= 0.24) { f.active = false; f.sprite.visible = false; f.sprite.material.opacity = 0; continue; }
      const grow = Math.min(1, t / 0.06);                      // 0 -> full over 60 ms
      f.sprite.scale.setScalar(1.8 * (f.power ?? 1) * grow);
      f.sprite.material.opacity = t < 0.06 ? 1 : 1 - (t - 0.06) / 0.18;
    }
    for (const w of shockwaves) {
      if (!w.active) continue;
      const g = (heardNow - w.t0) / 0.3;
      if (g >= 1) { w.active = false; w.mesh.visible = false; w.mesh.material.opacity = 0; continue; }
      w.mesh.scale.setScalar(w.r0 * (1 + 2 * (w.power ?? 1) * g));
      w.mesh.material.opacity = 1 - g;
    }
    for (const st of streaks) {
      if (!st.active) continue;
      const g = (heardNow - st.t0) / st.life;
      if (g >= 1) { st.active = false; st.mesh.visible = false; st.mesh.material.opacity = 0; continue; }
      const sdt = Math.max(0, heardNow - st.tPrev); st.tPrev = heardNow;
      st.vel.y -= 6 * sdt;
      st.pos.addScaledVector(st.vel, sdt);
      st.mesh.position.copy(st.pos);
      // face the camera, long axis along the on-screen velocity
      st.mesh.quaternion.copy(camera.quaternion);
      _eTang.copy(st.pos).project(camera);
      _eSide.copy(st.pos).add(st.vel).project(camera);
      st.mesh.rotateZ(Math.atan2(_eSide.y - _eTang.y, _eSide.x - _eTang.x) - Math.PI / 2);
      st.mesh.scale.set(0.03, 0.15 + st.vel.length() * 0.03, 1);
      fireColor(0.1 + 0.8 * g, _fc);
      st.mesh.material.color.copy(_fc);
      st.mesh.material.opacity = 1 - g;
    }
    for (const em of embers) {
      if (!em.active) continue;
      const g = (heardNow - em.t0) / em.life;
      if (g >= 1) { em.active = false; em.sprite.visible = false; em.sprite.material.opacity = 0; continue; }
      const edt = Math.max(0, heardNow - (em.tPrev ?? em.t0)); em.tPrev = heardNow;
      em.pos.addScaledVector(em.vel, edt);
      em.sprite.position.copy(em.pos);
      em.sprite.material.opacity = (1 - g) * (0.7 + 0.3 * Math.random());   // flicker
    }

    // splinters + the tumbling arrowhead: fly, fall, spin, gone after 0.8 s
    // (they were spawned but never updated — frozen in the drum forever)
    for (const group of [splinters, tumblers]) {
      for (const x of group) {
        if (!x.active) continue;
        if (heardNow - x.t0 >= 0.8) { x.active = false; x.mesh.visible = false; continue; }
        const dt = Math.max(0, heardNow - x.tPrev); x.tPrev = heardNow;
        x.vel.y -= 9.8 * dt;
        x.pos.addScaledVector(x.vel, dt);
        x.mesh.position.copy(x.pos);
        x.mesh.rotation.x += x.spin.x * dt;
        x.mesh.rotation.y += x.spin.y * dt;
        x.mesh.rotation.z += x.spin.z * dt;
      }
    }

    fxCamera.position.copy(camera.position);
    fxCamera.quaternion.copy(camera.quaternion);
    fxCamera.projectionMatrix.copy(camera.projectionMatrix);
    fxCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    if (!fxSorted) sortFx();
    composer.render();
  }

  /**
   * Mark the note (laneIdx, noteTime) as hit so its arrow plays its outcome.
   * The outcome fires the moment the arrow reaches its face (or immediately
   * if this call comes after that).
   * @param {"HIT"|"NEAR"} kind
   */
  function hit(laneIdx, noteTime, kind, power = 1) {
    const e = findEntry(laneIdx, noteTime);
    if (e) { e.hit = kind; e.power = power; }
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
      const lmat = drumLabelMats[i];
      if (p >= 1) {
        f.active = false;
        mat.opacity = 1;
        mat.transparent = false;
        lmat.opacity = 1;
      } else {
        mat.opacity = p;
        lmat.opacity = p;
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
  // debug: what each drum actually is right now (used by the browser harness)
  function debugDrums() {
    return drumMeshes.map((m, i) => ({ i, visible: m.visible, opacity: +drumMat[i].opacity.toFixed(2), transparent: drumMat[i].transparent, fading: drumFade[i].active }));
  }

  // ---- the owner's drum model (public/models/Bdrum.glb) --------------------
  // Head is the model's +y. Each drum is a scaled clone whose HEAD lands exactly
  // on drumFace[i], so arrows, charge light, spirits, hands and letters keep
  // aiming at the same points. The coloured cylinders stand in until it loads;
  // then they hide and drumMat/drumMeshes point at the model's clones, so the
  // press flash, fades and spirit pulses work on the real drum.
  new GLTFLoader().load("/models/Bdrum.glb", (gltf) => {
    const src = gltf.scene;
    src.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const headR = Math.max(size.x, size.z) / 2;
    for (let i = 0; i < 6; i++) {
      const L = LANES3D[i];
      const k = L.radius / headR;
      const holder = new THREE.Group();
      const model = src.clone(true);
      model.scale.multiplyScalar(k);
      // put the model's top-centre (its head) at the holder origin
      model.position.set(-(box.min.x + box.max.x) / 2 * k, -box.max.y * k, -(box.min.z + box.max.z) / 2 * k);
      holder.add(model);
      if (L.upright) holder.rotation.x = Math.PI / 2;     // head (+y) turns to face the player (+z)
      holder.position.copy(drumFace[i]);
      // one cloned material per drum, lightly tinted toward its lane colour
      let mat = null;
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        if (!mat) {
          mat = o.material.clone();
          mat.color.lerp(hexToColor(colors[drumOf(i)] || "#888888"), 0.22);
          mat.emissive = new THREE.Color(0x000000);
        }
        o.material = mat;
      });
      scene.add(holder);
      drumMeshes[i].visible = false;                       // retire the stand-in cylinder
      holder.visible = drumVisible[i];
      drumMeshes[i] = holder;
      drumMat[i] = mat;
    }
  }, undefined, (err) => console.warn("drum model failed to load; keeping stand-ins", err));

  return { resize, update, hit, press, strike, setDrumVisible, debugDrums };
}
