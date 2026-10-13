/* stage3d.js — seated first-person 3D layout.
   Lanes 0-2 (layout.top): upright hand drums facing the player.
   Lanes 3-5 (layout.bottom): floor drums in front, heads facing up.
   Flaming billboard arrows fly in on the audio clock (the arrows ARE the
   notes), arcing in so they are always seen side-on. All effect lighting
   is fake: additive sprite flames and glows, no PointLights. */

import { gltfLoader, initModelLoader } from "./gltf.js";
import { withBase } from "../base.js";
import KTX_LIST from "./ktx-list.json";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createCourtyard, ARCHER_ROOF_Y, ARCHER_ROOF_X, ARCHER_ROOF_Z, FAR_WALL } from "./courtyard.js";
import { createBraziers } from "./braziers.js";
import { createCove, BOOTH_POS, DOCK, COVE } from "./cove.js";
import { createHydra } from "./hydraBoss.js";
import { loadEdits, setLevelScene, getSetting } from "./editables.js";
import { createProps } from "./props.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { createVrHits } from "../input/vrhits.js";
import { createFire } from "./fire.js";
import { createStation, BAR_MID_Z, BARS, PER_ROW } from "./stations.js";
import { createDefense } from "./defense.js";
import { createTroops } from "./troops.js";
import { createPool, poolContains, POOL } from "./pool.js";
import { createBatcher } from "./batcher.js";
import { installPerf } from "../dev/perf.js";
import { bootlog } from "../bootlog.js";

const APPROACH_S = 4.0;   // seconds of visible flight (rocket arrows: a bit slower, owner) — must match main.js
const STUCK_S = 0.6;      // seconds an unhit arrow stays stuck at the face
const ROCKET_SCALE = 1.5;  // rocket arrows: bigger, to read down the lane
const ARROW_TIP = 0.36 * ROCKET_SCALE;   // the head's tip, along the arrow from its origin: the TIP stops on the drum, never past it (owner)

// module-level temps: no per-frame allocations
const UP = new THREE.Vector3(0, 1, 0);
const _tan = new THREE.Vector3();
const _pA = new THREE.Vector3();
const _pB = new THREE.Vector3();


// lane index -> drum placement.
// lanes 0-2: upright hand drums (cylinder axis along z, face toward +z).
// lanes 3-5: floor drums (cylinder axis vertical, head up).
const LANES3D = [
  // A STANDING kit within arm's reach (VR-ready; owner: "easy to play in VR").
  // Player stands at the origin, eyes ~1.6 m. Upright drums at chest height,
  // heads-up drums at waist height — like a real kit around you.
  // STAGGERED (owner, 2026-10-04): the two rows interleave, so every drum — and its lane — has
  // its own column: kick, hat, tom low, snare, tom high, crash, left to right
  { x: -0.45, y: 1.25, z: -0.68, radius: 0.19, depth: 0.28, upright: true },
  { x: 0.15, y: 1.27, z: -0.72, radius: 0.19, depth: 0.28, upright: true },
  { x: 0.75, y: 1.25, z: -0.62, radius: 0.19, depth: 0.28, upright: true },
  { x: -0.75, y: 0.76, z: -0.34, radius: 0.2, depth: 0.3, upright: false },   // head at y 0.91
  { x: -0.15, y: 0.76, z: -0.42, radius: 0.2, depth: 0.3, upright: false },
  { x: 0.45, y: 0.76, z: -0.38, radius: 0.2, depth: 0.3, upright: false },
];

// arrow spawn points per lane: archers spread across the FAR courtyard wall
// (~70 m out). Every arrow is visible from launch and lobs in on a high arc;
// the horizontal fan keeps each shaft readable side-on, never a dot.
// LANES (owner, 2026-10-03: "like guitar hero has lanes"): each drum's arrows come
// straight down the middle of the court on their own lane, lined up with their drum
// (spread a little wider far away), on a low arc — six lanes side by side, a highway
const SPAWNS = LANES3D.map((L) => new THREE.Vector3(L.x * 3.6, L.upright ? 3.4 : 2.6, -30));

// arc height of the parabolic lift on top of the straight line: a real lob
// kept low enough that the WHOLE flight stays on screen (owner, 2026-10-03: see them coming)
const ARC_LIFT = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9];   // a low arc: they ride their lane in

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
/** the drums this ROUND builds (kit.js): the present ones are laid out staggered and centred; the rest stand far off, hidden */
function layoutDrums(presentLanes, layout, spacing = 0.6) {
  const names = [...layout.top, ...layout.bottom].map((l) => l.name);
  const order = [3, 0, 4, 1, 5, 2];   // left to right: kick, hat, tom low, snare, tom high, crash
  const here = order.filter((i) => presentLanes.includes(names[i]));
  for (let i = 0; i < 6; i++) LANES3D[i].x = 50;   // off-stage
  here.forEach((i, k) => { LANES3D[i].x = (k - (here.length - 1) / 2) * spacing; });
}
export function createStage3D(canvas, layout, colors, opts = {}) {
  // THE KIT FOR THIS ROUND (owner, 2026-10-04: "16 max, but few if not needed"): which drums and gun
  // slots to build. Default: everything.
  const KIT = opts.kit || { drums: [...layout.top, ...layout.bottom].map((l) => l.name), bass: { bottom: [0, 1, 2, 3, 4, 5, 6, 7], top: [0, 1, 2, 3, 4, 5, 6, 7] }, treble: { bottom: [0, 1, 2, 3, 4, 5, 6, 7], top: [0, 4] } };
  // PHONES (owner, 2026-10-05: "you can't get to all the drums"): the kit comes in closer, and the
  // camera sits back a little and looks down more, so the whole kit is on the screen
  const TOUCH = !!opts.touch;
  layoutDrums(KIT.drums, layout, TOUCH ? 0.46 : 0.6);
  let skyMatRef = null;   // the sky dome's material (clouds animate on it)
  const TIER = ["high", "medium", "low", "lowest", "potato", "bare"].includes(opts.tier) ? opts.tier : "high";
  // no multisampling below medium: it multiplies every pixel's cost on a weak GPU
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: TIER === "high" || TIER === "medium",
    preserveDrawingBuffer: new URLSearchParams(location.search).has("shot") });   // ?shot: the dev photo hook in main.js reads the canvas
  renderer.shadowMap.enabled = true;                 // the foreground lantern casts shadows
  renderer.shadowMap.type = THREE.PCFShadowMap;   // (10-08 "blurry shadows a bit": PCF honours shadow.radius; PCFSoft ignores it — edges were one 3 cm texel)
  // GRAPHICS LEVEL — the game chooses it (auto-measured per device, or Settings):
  //   high    everything
  //   medium  phones: fewer pixels, no AO/SMAA, smaller shadow + mirror maps,
  //           fewer particles and fire lights
  //   low     tablets / weak GPUs: NO effect chain (drawn directly), no
  //           shadows, no fire lights, a simple shiny pool (sky reflection, no
  //           mirror), fewer particles, 1x pixels
  //   lowest  low + 0.7x render resolution, textures at most 512 px
  //   potato  lowest + half resolution, a cheap shield, a small fire, no decoy arrows
  //           (owner, 2026-10-03: the tablet "can barely play it")
  const PHONE = !!opts.phone;                          // THE PHONE VERSION (main.js): always the phone path, any tier
  const MOBILE = TIER !== "high" || PHONE;            // medium and below — and every phone
  const BARE = TIER === "bare";                      // (10-09) below potato: everything potato does, and no textures at all
  const LOW = TIER === "low" || TIER === "lowest" || TIER === "potato" || BARE;
  const POTATO = TIER === "potato" || BARE;
  // SMALL TEXTURES (owner, 2026-10-03: "cut the size for textures in lowest mode to 512"):
  // lowest and potato load public/small/ instead — every texture and model image at most
  // 512 px (tools/make-small-assets.py makes them). Every loader here uses the default manager.
  // GPU-COMPRESSED MODELS (10-09 speed pass): medium and every phone load public/ktx/models/ — KTX2 textures that stay compressed on the
  // chip (tools/make-ktx-assets.sh; only the models in its list, so a new one with no copy yet loads its original). High keeps the originals.
  const KTX_SET = new Set(KTX_LIST), KTX = MOBILE && !(TIER === "lowest" || POTATO) && !new URLSearchParams(location.search).has("noktx");
  initModelLoader(renderer);
  THREE.DefaultLoadingManager.setURLModifier((url) => {
    if ((TIER === "lowest" || POTATO) && /^\/(textures|models)\//.test(url)) return withBase("/small" + url);
    const m = KTX && /^\/models\/([^/?]+\.glb)$/.exec(url);
    return withBase(m && KTX_SET.has(m[1]) ? "/ktx" + url : url);   // + the base, when served under one (GitHub Pages)
  });
  {
    const gl = renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    bootlog("renderer", { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?", maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      webgl2: renderer.capabilities.isWebGL2, tier: TIER });
  }
  renderer.setPixelRatio(POTATO ? 0.5 : TIER === "lowest" ? 0.7 : LOW ? 1 : MOBILE ? Math.min(window.devicePixelRatio || 1, 1.5) : (window.devicePixelRatio || 1));
  // VR: the headset is the camera, the controllers hold the sticks
  renderer.xr.enabled = true;
  // FILM LOOK: ACES filmic tone mapping (the Unreal Engine curve) — bright fire
  // rolls off into soft highlights instead of clipping to flat white
  // a shader that fails to compile is SKIPPED silently by three — log it so device.log shows it (2026-10-07: the sea vanished for a pass)
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const msg = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join(" | ").slice(0, 600);
    // (10-08: his phone logged EMPTY messages — say which shader, which stage failed, and the device's limits)
    const src = (sh) => (gl.getShaderSource(sh) || "");
    const name = (/#define SHADER_NAME (.*)/.exec(src(fs)) || /#define SHADER_NAME (.*)/.exec(src(vs)) || [])[1] || "";
    const marks = ["uSwell", "chopAt", "skyCol", "uDrops", "WaveShader", "uSim", "uLevel", "Reflector", "panoSample"].filter((m) => src(vs).includes(m) || src(fs).includes(m));
    bootlog("shader error", { msg, name, marks, vsOk: gl.getShaderParameter(vs, gl.COMPILE_STATUS), fsOk: gl.getShaderParameter(fs, gl.COMPILE_STATUS),
      linkOk: gl.getProgramParameter(program, gl.LINK_STATUS), vUniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS), fUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
      vTex: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS), varyings: gl.getParameter(gl.MAX_VARYING_VECTORS) });
    console.error("shader error", msg);
    // THE SEA HEALS ITSELF (10-08: his phone couldn't LINK the full sea — measured: dropping any one per-vertex part fixes it):
    // on a sea failure, switch off the next part (chop height, then ripple rings, then the cloth) and let it rebuild
    try {   // (sea may not exist yet: an early shader is someone else's)
      if (marks.includes("uSwell") && sea) {
        const d = sea.mesh.material.defines, next = ["NO_VCHOP", "NO_RIPPLES", "NO_SIM"].find((k) => !d[k]);
        if (next) { d[next] = 1; sea.mesh.material.needsUpdate = true; bootlog("sea fallback", { dropped: next }); }
      }
    } catch { /* not built yet */ }
  };
  renderer.toneMapping = THREE.AgXToneMapping;   // (10-08 "more real": AgX keeps colours natural where ACES pushed everything orange)
  renderer.toneMappingExposure = 1.15;
  renderer.xr.setReferenceSpaceType("local-floor");   // y = 0 is the real floor

  const scene = new THREE.Scene();

  // ---- TWILIGHT, just after sunset (owner's call) -------------------------
  // Sky dome: deep indigo overhead -> dusky violet -> a warm orange-pink glow
  // on the horizon, BEHIND the archers' wall (the -z direction). Kept dark
  // enough overhead that the flaming arrows still pop.
  const HORIZON_HAZE = 0x4a3a5c;
  scene.background = null;   // the sky dome is the background; a colour here would be repainted by the fx pass over the whole frame
  scene.fog = new THREE.FogExp2(HORIZON_HAZE, 0.011);   // fire ignores fog (fog:false on sprites)
  {
    const skyMat = skyMatRef = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        zenith:  { value: new THREE.Color(0x0e1434) },
        mid:     { value: new THREE.Color(0x3a2f62) },
        glow:    { value: new THREE.Color(0xf08a5a) },
        ground:  { value: new THREE.Color(0x1c1624) },
        // the owner's sunset panorama, painted across the sky IN FRONT (it
        // isn't a full 360 image: its ends fade into the gradient behind)
        pano:    { value: null },
        // the owner's CLOUD MAP (equirect, white = cloud): alpha over the sky,
        // slowly rotating; lit by the sunset on the side facing the sun
        clouds:   { value: null },
        cloudOn:  { value: 0 },
        cloudRot: { value: 0 },
        panoOn:  { value: 0 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 zenith, mid, glow, ground; uniform sampler2D pano; uniform float panoOn; uniform sampler2D clouds; uniform float cloudOn, cloudRot; varying vec3 vDir;
        // panorama placement: sun (u 0.40 in the image) dead ahead, behind the
        // archers' far wall; image horizon (v 0.725 from the top) lifted 9.5 deg
        // so the sun sits just above the (8 m) wall; square pixels: 220 deg wide
        const float SUN_U = 0.40, HOR_V = 0.725, SPAN = 3.8397, LIFT = 0.165;
        vec4 panoSample(vec3 d) {
          float az = atan(d.x, -d.z);                       // 0 = straight ahead (-z)
          float el = asin(clamp(d.y, -1.0, 1.0)) - LIFT;
          float u = SUN_U + az / SPAN;
          float v = HOR_V - el / SPAN * 2.0;               // 1024 x 506 px: v spans half the angle per unit
          float edge = smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.88, 1.0, u)) * smoothstep(0.0, 0.1, v);
          vec3 c = texture2D(pano, vec2(u, 1.0 - v)).rgb;
          float lum = dot(c, vec3(0.3, 0.55, 0.15));
          c *= 1.0 + 5.0 * smoothstep(0.82, 1.0, lum);     // the sun and hot cloud rims glow (bloom)
          return vec4(c, edge * panoOn);
        }
        // the sky's colour in a direction (gradient + afterglow band + the painted sunset), no clouds
        vec3 skyCol(vec3 d) {
          float h = max(d.y, 0.0), toward = smoothstep(-0.2, 1.0, -d.z);
          float band = exp(-h * 9.0) * (0.35 + 0.65 * toward);
          vec3 c = mix(mix(mid, zenith, smoothstep(0.0, 0.55, h)), glow, clamp(band, 0.0, 1.0) * 0.85);
          vec4 p = panoSample(d); return mix(c, p.rgb, p.a);
        }
        void main(){
          float h = vDir.y;
          vec3 c;
          vec4 p = panoSample(vDir);   // (the clouds below use it: lighter over the painted sunset)
          if (h >= 0.0) c = skyCol(vDir);
          else {
            // THE OPEN SEA to the horizon (owner, 2026-10-08: "the ocean has to at least LOOK like it goes out forever"):
            // below the horizon the dome is water — deep slate looking down, a mirror of the sky toward the horizon
            // (Schlick, water's 2%); the real sea mesh fades into this at its far edge (sea.js)
            float F = 0.02 + 0.98 * pow(1.0 - min(1.0, -h * 1.0), 5.0);
            vec3 refl = skyCol(vec3(vDir.x, -h, vDir.z)) * 0.85;
            c = mix(vec3(0.035, 0.07, 0.10), refl, F);
            c = mix(c, ground, smoothstep(0.35, 0.9, -h));   // straight down (never seen) stays dark
          }
          if (cloudOn > 0.5 && h > 0.0) {
            float az = atan(vDir.x, -vDir.z) + cloudRot;
            float el = asin(clamp(h, 0.0, 1.0));
            vec2 cuv = vec2(fract(az / 6.2832 + 0.5), 0.5 + el / 3.1416);   // upper half of the map = the sky
            float cov = smoothstep(0.18, 0.75, texture2D(clouds, cuv).r);
            cov *= smoothstep(0.0, 0.10, el);                                // melt into the horizon
            cov *= mix(1.0, 0.5, p.a);                                       // lighter over the painted sunset
            float toward = pow(max(dot(normalize(vDir), normalize(vec3(0.0, 0.165, -0.986))), 0.0), 2.0);
            vec3 lit = mix(vec3(0.20, 0.14, 0.24), vec3(1.05, 0.56, 0.34), toward * 0.85 + 0.12);
            lit += vec3(0.5, 0.28, 0.12) * toward * (1.0 - cov);             // thin edges facing the sun glow
            c = mix(c, lit, cov * 0.85);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMat);
    sky.renderOrder = -1;
    scene.add(sky);
    // IMAGE-BASED LIGHTING: the twilight sky, blurred into an environment map,
    // lights and reflects on every surface (soft sky sheen on drums and stone)
    {
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat));
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    bootlog("sky lighting built");
    pmrem.dispose();
    // load the panorama; once in, rebuild the sky lighting from it too
    new THREE.TextureLoader().load("/textures/sky_sunset.webp", (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;          // no mips: the atan seam would pick a tiny mip and draw a line
      tex.generateMipmaps = false;
      skyMat.uniforms.pano.value = tex;
      skyMat.uniforms.panoOn.value = 1;
      const pm = new THREE.PMREMGenerator(renderer);
      const old = scene.environment;
      scene.environment = pm.fromScene(envScene, 0.02).texture;
      if (old) old.dispose();
      pm.dispose();
    }, undefined, (err) => console.warn("sky panorama failed to load", err));
    scene.environmentIntensity = 0.25;   // (10-08: "reduce ambient" 0.4 → 0.25)
    }
  }

  // light: cool sky from above, warm bounce below, a low warm AFTERGLOW from the
  // horizon behind the archers that rims the drums, and the warm lantern close in
  // REAL LIGHT (owner, 2026-10-08: "fix the lighting so it looks more real"): the low SUN is the key — strong, warm,
  // CASTING SHADOWS (long column shadows down the courtyard; the courtyard wall shades the cove) — and what it doesn't
  // reach is lit only by the cool dusk SKY (no flat ambient any more): warm light, blue shadows, like a real sunset.
  const skyFill = new THREE.HemisphereLight(0x5a6aa8, 0x2e2420, 0.26); scene.add(skyFill);   // (10-08: "reduce ambient" 0.42 → 0.26)    // (was 0.72 + an ambient 0.3: lit from everywhere)
  const afterglow = new THREE.DirectionalLight(0xffa066, 2.6);
  let AFTERGLOW = 2.6;   // full sunlight; clouds over the sun dim it (below) — the editor's Lighting: sun
  if (!LOW) {
    afterglow.castShadow = true;
    // STATIC SUN SHADOWS (10-08, measured: the sun's shadow pass was 2244 of 3658 draw calls a frame — the whole level, every
    // frame, though the scenery never moves): drawn ONCE, and again only when something changes (the layout loads, a model
    // arrives, the editor moves something, the sun moves). The drums, hands and sticks keep live shadows from the lantern.
    afterglow.shadow.autoUpdate = false; afterglow.shadow.needsUpdate = true;
    const sc = afterglow.shadow.camera, R = 58;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 260;   // the whole courtyard and the cove
    afterglow.shadow.mapSize.set(PHONE ? 1024 : MOBILE ? 2048 : 4096, PHONE ? 1024 : MOBILE ? 2048 : 4096);
    afterglow.shadow.bias = -0.0004; afterglow.shadow.normalBias = 0.04;
    afterglow.shadow.radius = 5;   // soft edges: a low sun through dusty air (owner 10-08: "blurry shadows a bit")
  }
  // CLOUDS: the owner's cloud map rotates slowly across the sky; the game reads
  // the map's pixels to know how much cloud is in front of the sun, and the
  // sunlight dims / brightens with it
  const CLOUD_SPEED = (2 * Math.PI) / 600;   // one full turn of the sky in ten minutes
  let cloudPix = null, cloudW = 0, cloudH = 0, cloudRot = 0, sunlit = 1;
  new THREE.TextureLoader().load("/textures/clouds.jpg", (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    skyMatRef.uniforms.clouds.value = tex;
    skyMatRef.uniforms.cloudOn.value = 1;
    const c = document.createElement("canvas");
    cloudW = c.width = 256; cloudH = c.height = 128;            // a small copy is plenty to read coverage
    const g = c.getContext("2d");
    g.drawImage(tex.image, 0, 0, cloudW, cloudH);
    cloudPix = g.getImageData(0, 0, cloudW, cloudH).data;
  }, undefined, (err) => console.warn("cloud map failed to load", err));
  /** how much cloud covers the sun right now (0 clear .. 1 thick), a small blur around it */
  function cloudOverSun() {
    if (!cloudPix) return 0;
    const u = ((cloudRot / (2 * Math.PI) + 0.5) % 1 + 1) % 1;   // the sun is dead ahead (azimuth 0)
    const v = 0.5 + Math.asin(0.165) / Math.PI;                   // ~9.5 degrees up
    const cx = Math.floor(u * cloudW), cy = Math.floor((1 - v) * cloudH);
    let sum = 0, n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = ((cx + dx) % cloudW + cloudW) % cloudW, y = Math.min(cloudH - 1, Math.max(0, cy + dy));
      sum += cloudPix[(y * cloudW + x) * 4] / 255; n++;
    }
    const cov = sum / n;
    return Math.min(1, Math.max(0, (cov - 0.18) / 0.57));         // same thresholds as the sky shader
  }
  // from the panorama's sun: dead ahead (-z), ~9.5° up; the light looks at the middle of the level so its shadow box covers it
  afterglow.target.position.set(0, 0, 4);
  const sunAt = (deg) => { const a = THREE.MathUtils.degToRad(deg); afterglow.position.set(0, Math.sin(a) * 120, 4 - Math.cos(a) * 120); };
  sunAt(9.5);
  scene.add(afterglow, afterglow.target);
  // the drum lantern: textured wood/leather needs a warm key light close in
  // the drum lantern: a warm SPOT just above and behind the player, aimed at the
  // drums, casting soft shadows (drums onto the ground, hands/sticks onto drums)
  const lantern = new THREE.SpotLight(0xffb36a, 26, 9, Math.PI / 4.2, 0.65, 1.4);
  lantern.position.set(0.35, 2.7, 1.1);
  lantern.target.position.set(0, 0.9, -0.5);
  lantern.castShadow = !MOBILE;   // (10-08, measured: its shadow pass is ~612 draw calls a frame — phones skip it; elsewhere only at the drums, setStation)
  lantern.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
  lantern.shadow.camera.near = 0.3;
  lantern.shadow.camera.far = 9;
  lantern.shadow.radius = 3;   // (PCF now: a touch of blur, as PCFSoft gave it)
  lantern.shadow.bias = -0.0004;
  lantern.shadow.normalBias = 0.02;
  lantern.shadow.radius = 4;
  scene.add(lantern, lantern.target);
  if (LOW) { renderer.shadowMap.enabled = false; lantern.castShadow = false; }   // no real-time shadows on the low levels

  let AO_ON = false; const _aoDir = new THREE.Vector3();   // the AO's own switch (off toward the sea, below)
  const camera = new THREE.PerspectiveCamera(
    60, canvas.clientWidth / canvas.clientHeight, 0.1, 260,   // (10-08: 200 → 260: the open sea reaches the draw distance)
  );
  // FOV is set HORIZONTALLY (games' convention; owner: 110), vertical follows the window shape
  // held upright (portrait) a 110-degree width would mean a ~145-degree fisheye
  // height: narrower there, and the height capped
  const fitFov = () => {
    const h = camera.aspect >= 1 ? 110 : 80;
    const v = 2 * Math.atan(Math.tan(h * Math.PI / 360) / camera.aspect) * 180 / Math.PI;
    camera.fov = Math.min(v, 120);
  };
  fitFov();
  camera.position.set(0, 2.1, TOUCH ? 1.05 : 0.75);           // a little above standing height: more of the battlefield (owner, 2026-10-03; VR uses the headset); phones: back a touch
  camera.lookAt(new THREE.Vector3(0, TOUCH ? 0.7 : 0.95, -2.2));  // tilted down: the bottom of the play area and its indicators in view (owner), the court beyond
  // LOOK AROUND (screen mode): arrow keys / thumbsticks turn the view a little
  // off this forward pose; let go and it drifts back to facing the kit
  const baseQuat = camera.quaternion.clone();
  // STATIONS: drums ahead, bass to the right, treble to the left. The screen
  // camera turns between them (in VR you turn yourself); look-around rides on top.
  const PITCH0 = new THREE.Euler().setFromQuaternion(baseQuat, "YXZ").x;   // the drums' downward look
  const STATIONS = {
    drums:  { yaw: 0,            pos: new THREE.Vector3(0, 2.1, TOUCH ? 1.05 : 0.75) },
    gate:   { yaw: Math.PI,      pos: new THREE.Vector3(0, 2.1, TOUCH ? 1.05 : 0.75), pitch: 0.04 },   // THE BIG TO-DO (10-09): turned round to the sea gate
    bass:   { yaw: -Math.PI / 2, pos: new THREE.Vector3(TOUCH ? -0.05 : -0.35, TOUCH ? 1.8 : 2.1, 0.6) },   // phones: right up at the rack, a little lower — the guns fill the screen
    treble: { yaw: Math.PI / 2,  pos: new THREE.Vector3(TOUCH ? 0.05 : 0.35, TOUCH ? 1.8 : 2.1, 0.6) },
    sea:    { yaw: Math.PI,      pos: new THREE.Vector3(0, 2.1, BOOTH_POS.z - 0.75), pitch: -0.06 },   // round 4: at the podium on the dock, facing the sea, gaze level (the hydra is tall)
  };
  let station = "drums";
  const st = { yaw: 0, pos: STATIONS.drums.pos.clone() };
  const _eul = new THREE.Euler(0, 0, 0, "YXZ");
  const LOOK_YAW = 25 * Math.PI / 180, LOOK_PITCH = 12 * Math.PI / 180;
  const look = { x: 0, y: 0, inX: 0, inY: 0 };
  const _qYaw = new THREE.Quaternion(), _qPitch = new THREE.Quaternion(), _xAxis = new THREE.Vector3(1, 0, 0);

  // AO for everything: GTAO (screen-space) between the scene render and output
  const FX_LAYER = 1;
  // THE SHIELD'S OWN BLOOM (owner, 2026-10-03: "like old 3ds object channels"): the
  // shield also sits on layer 2; that layer alone is rendered on black, bloomed
  // hard, tinted a cool blue and added over the finished picture — a magic halo
  // on the shield only, nothing else blooms more than before
  const SHIELD_LAYER = 2;
  // THE SHIELD GLOW'S BLOCKERS (10-09 speed pass): the glow is hidden behind solid things in front of it, and only things near
  // you can stand in front of a shield, a gun's orb or a crystal — so that black pass draws only solid meshes within OCC_RANGE
  // of the camera (re-picked whenever the camera has moved 2 m), plus the enemies (animated or instanced: they walk right up)
  const OCC_LAYER = 3, OCC_RANGE = new URLSearchParams(location.search).has("occfull") ? 1e9 : 4;   // ?occfull: the old whole-scene pass, to compare   // the dome is 3.4 m round (0,0,0.3), the stations' cameras stand near its middle
  const _occAt = new THREE.Vector3(1e9, 0, 0), _occB = new THREE.Box3();
  // FULL-SONG CUES (owner, 2026-10-10: "if there's too many notes at once, cut the brightness so it goes bright and STOPS before the
  // next note, not a continuous bright"): each target flashes for CUE_PULSE s before its beat and is dark again 60 ms after
  let cuePulse = false; const CUE_PULSE = 0.3;
  let glowFrame = 0;
  let glowers = null; const _gFr = new THREE.Frustum(), _gM = new THREE.Matrix4();   // everything on the glow channel (built once, after the scene is up)
  const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  function glowShowing() {
    if (!glowers) { glowers = []; scene.traverse((o) => { if (o.layers.isEnabled(SHIELD_LAYER) && (o.isMesh || o.isSprite || o.isLine || o.isPoints)) glowers.push(o); }); }
    _gFr.setFromProjectionMatrix(_gM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const o of glowers) if (shown(o) && (!o.frustumCulled || !o.geometry || _gFr.intersectsObject(o))) return true;   // and ON SCREEN (the treble crystals kept it on everywhere)
    return false;
  }
  function tagOccluders(force) {
    if (!force && camera.position.distanceToSquared(_occAt) < 4) return;
    _occAt.copy(camera.position); scene.updateMatrixWorld();   // (the first pick ran before anything was placed: all at the origin, all 'near')
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh || o.isInstancedMesh) { o.layers.enable(OCC_LAYER); return; }
      if (!o.layers.isEnabled(0) || !o.geometry) { o.layers.disable(OCC_LAYER); return; }
      if (o.material && o.material.side === THREE.BackSide) { o.layers.disable(OCC_LAYER); return; }   // a sky dome: behind everything
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();   // a box, not a sphere: a 38 m wall's sphere reaches you from 27 m off
      _occB.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (_occB.distanceToPoint(_occAt) < OCC_RANGE) o.layers.enable(OCC_LAYER); else o.layers.disable(OCC_LAYER);
    });
  }
  let shieldGlow = null, shieldCamera = null, shieldOccCamera = null, shieldMix = null, shieldOnly = false;
  // ROUND BLOOM (owner, 10-09: "highlights make little squares — round that out"): a glint on the pool is ONE pixel many times brighter
  // than white; the bloom's low-resolution blur turns it into a visible block. Capped going in (the "firefly clamp" real engines use),
  // no single pixel can outshine its neighbours enough to draw a square — the glow stays a soft round falloff.
  function roundBloom(pass, max) {
    const m = pass.materialHighPassFilter, line = "gl_FragColor = mix( outputColor, texel, alpha );";
    if (m && m.fragmentShader.includes(line)) {
      m.fragmentShader = m.fragmentShader.replace(line, line + `\n\t\t\tfloat pk = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b); gl_FragColor.rgb *= min(1.0, ${max.toFixed(2)} / max(pk, 1e-4));`);
      m.needsUpdate = true;
    } else bootlog("round bloom", { error: "bright-pass shader changed — not patched" });
    return pass;
  }
  let composer = null, gtao = null, bloom = null, lens = null, smaa = null;
  const PERF = new URLSearchParams(location.search).has("perf"); let perf = null;
  if (!LOW && !PHONE) {   // (10-09) PHONES: no effects chain — the scene drawn once, straight to the screen (bloom etc. were full-screen passes)
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // glowing effects (sprites, additive cards) live on layer 1 and render in
  // their own pass RIGHT AFTER the scene, into the same buffer: they're
  // depth-tested against the real scene (flames hide behind pillars) and the
  // AO's own depth pass (main camera = layer 0) never sees them, so no black
  // squares. (Drawn after the AO they tested against a stale depth buffer the
  // full-screen passes had written into, and every distant flame vanished.)
  }
  const fxCamera = camera.clone();
  fxCamera.layers.set(FX_LAYER);
  let fxPass = null;
  if (composer) {
  fxPass = new RenderPass(scene, fxCamera);
  fxPass.clear = false;
  fxPass.clearDepth = false;
  composer.addPass(fxPass);
  } else camera.layers.enable(FX_LAYER);   // drawn directly: the main camera sees the glowing effects too
  // THE FIRE: one particle simulation for every flame, ember and smoke wisp
  const fireSim = createFire(scene, { layer: FX_LAYER, ...(LOW ? { maxFire: POTATO ? 500 : TIER === "lowest" ? 1500 : 2500, maxSmoke: POTATO ? 80 : 400 } : MOBILE ? { maxFire: 6000, maxSmoke: 1500 } : {}) });
  let fireT = performance.now(), fireDt = 0;
  if (composer) {
  gtao = new GTAOPass(scene, camera, canvas.clientWidth || 1280, canvas.clientHeight || 720);
  gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16 });
  gtao.blendIntensity = 1.0;
  composer.addPass(gtao);
  gtao.enabled = !MOBILE && !new URLSearchParams(location.search).has("noao");   // ?noao: dev, the AO off (to tell what it does)
  AO_ON = gtao.enabled;
  // BLOOM: only what's brighter than white glows (fire, sparks, hit flashes)
  bloom = new UnrealBloomPass(new THREE.Vector2(canvas.clientWidth || 1280, canvas.clientHeight || 720), 0.42, 0.6, 0.85);   // (10-09 "a little much": 0.55 → 0.42)
  roundBloom(bloom, 2.5);
  composer.addPass(bloom);
  {
    shieldCamera = camera.clone();
    shieldCamera.layers.set(SHIELD_LAYER);
    shieldGlow = new EffectComposer(renderer);
    shieldGlow.renderToScreen = false;
    // FOREGROUND FIRST (owner, 2026-10-03: "the shield is blocking the drums"): the
    // real scene as flat black, depth and all — whatever stands in front of the dome
    // (drums, guns, sticks) hides it here too, so the glow only rises from shield you see
    shieldOccCamera = camera.clone();
    shieldOccCamera.layers.set(OCC_LAYER);   // (10-09 speed pass) only what's NEAR — it was the whole scene again, a third of every frame
    const occ = new RenderPass(scene, shieldOccCamera, new THREE.MeshBasicMaterial({ color: 0x000000 }));
    occ.clearColor = new THREE.Color(0x000000); occ.clearAlpha = 1;
    shieldGlow.addPass(occ);
    const sp = new RenderPass(scene, shieldCamera);
    sp.clear = false;   // over the black foreground, depth-tested against it
    shieldGlow.addPass(sp);
    shieldGlow.addPass(roundBloom(new UnrealBloomPass(new THREE.Vector2(canvas.clientWidth || 1280, canvas.clientHeight || 720), 1.0, 0.7, 0.15), 2.5));
    composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null }, tGlow: { value: null }, tint: { value: new THREE.Color(0.22, 0.5, 1.0) }, amount: { value: 0.22 } },   // a deep blue halo, not a fog
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse, tGlow; uniform vec3 tint; uniform float amount; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 g = texture2D(tGlow, vUv).rgb;
          float l = dot(g, vec3(0.299, 0.587, 0.114));
          gl_FragColor = vec4(c.rgb + tint * l * amount, c.a); }`,   // blue-toned (owner)
    }));
    shieldMix = composer.passes[composer.passes.length - 1];
    shieldMix.uniforms.tGlow.value = shieldGlow.readBuffer.texture;
  }
  composer.addPass(new OutputPass());
  // LENS FINISH (display space): vignette, a touch of chromatic fringing toward
  // the edges, fine film grain — small amounts, it should be felt not seen
  lens = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        float r2 = dot(d, d);
        vec2 ca = d * r2 * 0.012;                       // fringing grows toward the corners
        vec3 c = vec3(texture2D(tDiffuse, vUv + ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - ca).b);
        c *= mix(1.0, smoothstep(0.85, 0.2, r2 * 2.2), 0.55);   // vignette
        c += (hash(vUv * 1000.0) - 0.5) * 0.025;        // grain
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  composer.addPass(lens);
  // anti-aliasing (the effect chain bypasses the canvas's own MSAA)
  smaa = new SMAAPass((canvas.clientWidth || 1280) * renderer.getPixelRatio(), (canvas.clientHeight || 720) * renderer.getPixelRatio());
  composer.addPass(smaa);
  bootlog("effects chain built");
  smaa.enabled = !MOBILE;   // the mobile tier relies on its higher pixel density instead
  }

  // ground: dark stone, flat at y = 0 — STOPPING AT THE SEA WALL (2026-10-07: it ran under the cove at sea
  // level and hid the sea except where crests poked through — the "beach" he saw)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 200 + COVE.wallZ),
    new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = (COVE.wallZ - 200) / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // the environment mock-up (owner's reference: sandstone colonnade courtyard)
  bootlog("courtyard: start");
  const courtyard = createCourtyard(scene);
  const editsLoaded = loadEdits();
  editsLoaded.then(() => { const L = getSetting("lighting"); if (L) lighting.set(L); refreshSunShadow(); });
  // the sun's shadow map is redrawn when asked (static shadows, above) — and a few times while the models stream in
  function refreshSunShadow() { afterglow.shadow.needsUpdate = true; }
  for (const ms of [1500, 4000, 8000, 15000]) setTimeout(() => { try { bareify(); } catch (e) { bootlog("bare", { error: String(e) }); } rebatch(); refreshSunShadow(); if (ms >= 4000) warmShaders(ms); }, ms);
  // SHADER WARM-UP (10-09, the big engines do it behind the loading screen): compile every material in the scene now — hidden
  // ones too (the shield, sparks, lightning, acid) — so the first time each effect shows it doesn't stall the song to compile.
  // Repeated as the models stream in; anything already compiled costs nothing.
  // BARE (his ask 10-09: "for really weak tablets… all the way down to no textures, super simplified"): every lit material becomes a
  // plain MeshLambert in its texture's AVERAGE colour (the texture drawn into one pixel) — no texture reads, the cheapest lighting
  // three.js has. Shared: one replacement per original material. Runs with the load timers, so models that stream in are caught too.
  const bareOf = new Map();
  function avgColour(tex) {
    try { const img = tex && tex.image; if (!img || !img.width) return null;
      const c = document.createElement("canvas"); c.width = c.height = 1; const g = c.getContext("2d"); g.drawImage(img, 0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data; return new THREE.Color().setRGB(d[0] / 255, d[1] / 255, d[2] / 255, THREE.SRGBColorSpace);
    } catch { return null; }
  }
  function bareify() {
    if (!BARE) return;
    let n = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      const m = o.material;
      if (!(m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial) || m.userData.bare) return;
      if (!bareOf.has(m)) {
        const col = m.color ? m.color.clone() : new THREE.Color(1, 1, 1), avg = avgColour(m.map); if (avg) col.multiply(avg);
        const b = new THREE.MeshLambertMaterial({ color: col, emissive: m.emissive ? m.emissive.clone() : 0x000000, emissiveIntensity: m.emissiveIntensity ?? 1,
          side: m.side, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, vertexColors: m.vertexColors, fog: m.fog });
        // LIVE links to the original: the game flashes buttons and drumheads by changing THEIR material (emissive, opacity), and colours
        // set at runtime when there's no texture — so those are shared, not copied
        b.emissive = m.emissive || b.emissive; if (!m.map && m.color) b.color = m.color;
        for (const k of ["emissiveIntensity", "opacity", "visible"]) Object.defineProperty(b, k, { get: () => m[k], set: (v) => { m[k] = v; }, configurable: true });
        b.userData.bare = true; b.name = (m.name || "") + " (bare)"; bareOf.set(m, b);
      }
      o.material = bareOf.get(m); n++;
    });
    if (n) bootlog("bare", { swapped: n, materials: bareOf.size });
  }
  function warmShaders(at) {
    if (!renderer.compileAsync) return;
    const t = performance.now(), before = renderer.info.programs ? renderer.info.programs.length : 0;
    renderer.compileAsync(scene, camera).then(() => bootlog("warm shaders", { at, ms: Math.round(performance.now() - t), programs: renderer.info.programs ? renderer.info.programs.length : null, before }), (e) => bootlog("warm shaders", { at, error: String(e) }));
  }
  editsLoaded.then((e) => bootlog("level edits", { n: Object.keys(e).length }));   // the saved layout, applied as each piece registers
  // THE GLUE (batcher.js, 10-09 speed pass): while you play, the town's small still pieces are drawn a material at a time;
  // in the editor they come apart. Re-glued as the models stream in (the timers above) and when you leave the editor.
  let batcher = null;
  function rebatch() {
    if (!batcher || fly.on || new URLSearchParams(location.search).has("nobatch")) return;
    const t = performance.now();
    if (batcher.build()) bootlog("batched", { ...batcher.stats, ms: Math.round(performance.now() - t) });
  }
  const cove = createCove(scene), sea = cove.userData.sea;
  // (10-08, MEASURED on his phone with ?seatest: the full sea shader won't LINK there; dropping ANY ONE of the per-vertex parts —
  // cloth, chop height, ripple rings — links it. Phones drop the vertex chop HEIGHT: a few cm of bump; the chop you see is per pixel)
  if (MOBILE) { sea.mesh.material.defines.NO_VCHOP = 1; sea.mesh.material.needsUpdate = true; }
  if (new URLSearchParams(location.search).has("seabreak")) sea.mesh.material.defines.SEA_BREAK = 1;   // TEST: the sea won't link until a part is dropped
  setLevelScene(scene);
  // SEA LINK TEST (10-08, his phone can't LINK the sea shader): ?seatest builds the sea material with each suspect switched off
  // and reports which versions link — run it once on the phone, read device.log ("seatest")
  if (new URLSearchParams(location.search).has("seatest")) setTimeout(() => {
    const gl = renderer.getContext(), base = sea.mesh.material, res = {};
    for (const v of ["FULL", "NO_SIM", "NO_VCHOP", "NO_FCHOP", "NO_RIPPLES", "NO_SIM+NO_FCHOP", "NO_SIM+NO_VCHOP+NO_FCHOP+NO_RIPPLES"]) {
      const m = base.clone(); m.uniforms = base.uniforms; m.defines = { ...base.defines };
      if (v !== "FULL") for (const d of v.split("+")) m.defines[d] = 1;
      const t = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); mesh.frustumCulled = false; t.add(mesh);
      try { renderer.compile(t, camera); const p = renderer.properties.get(m).currentProgram;
        res[v] = p ? gl.getProgramParameter(p.program, gl.LINK_STATUS) : "no program"; } catch (e) { res[v] = "threw " + String(e).slice(0, 80); }
    }
    bootlog("seatest", res);
  }, 3000);   // the level's own geometry becomes editable (editables.js levelPieceOf); saved piece edits apply now   // round 4's cove behind the sea gate (blockout); the sea rolls and ripples (sea.js)
  // THE HYDRA (hydraBoss.js): three necks out of the sea in front of the dock, the rigged heads
  // on top; rises on hydra.rise() — round 4 / the conduct feel-test; ?hydra=1 raises it at load (dev)
  const _sprayP = new THREE.Vector3();
  sea.onSpray = LOW ? null : (x, y, z, power, dir) => fireSim.spray(_sprayP.set(x, y, z), power, dir);   // the sea's spray through the particle sim
  // ROUND 4's PLAY SPOT (10-08): the top of his altar (cove.js) if it's there, else the old podium. The camera, the hands, the
  // heads' aim and the acid dome all follow it, so moving the altar in the editor moves the whole play area.
  const EYE = 1.65;
  function playSpot() {
    const a = cove.userData.altar;
    if (!a || !a.visible) return new THREE.Vector3(0, DOCK.y + 0.08, BOOTH_POS.z);
    a.updateMatrixWorld(true);
    return a.localToWorld(new THREE.Vector3(0, a.userData.topY, 0));
  }
  function usePlaySpot() {
    const p = playSpot();
    STATIONS.sea.pos.set(p.x, p.y + EYE, p.z - 0.5);
    HAND_RESTS.sea[0].set(p.x + 0.66, p.y + 1.0, p.z + 0.1); HAND_RESTS.sea[1].set(p.x - 0.66, p.y + 1.0, p.z + 0.1);
    if (hydra) hydra.moveTo(p.clone().setY(p.y + EYE));
  }
  // THE FLIGHT IN (owner, 2026-10-09: "for the final battle it flies us to the altar — make a path up the stairs"): from the sea
  // gate along the dock, up the middle of his altar's stairs (measured in the model: centred on its +z face, x -0.035, foot at
  // z 0.95, top tier at y 0.36), onto the top, turning to face the sea; eased, ~7 s; then onDone (the count-in)
  let cine = null;
  function flyIn(seconds = 7, onDone) {
    usePlaySpot();
    if (hydra) for (let i = 0; i < 3; i++) hydra.standBack(i, true);   // the heads hang back while you climb (the fight picks its attacker)
    const a = cove.userData.altar, end = STATIONS.sea.pos.clone();
    if (!a || !a.children[0]) { if (onDone) onDone(); return; }
    a.updateMatrixWorld(true);
    const src = a.children[0], W = (x, y, z) => src.localToWorld(new THREE.Vector3(x, y, z)), EYE_UP = new THREE.Vector3(0, 1.65, 0);
    const foot = W(-0.035, -0.36, 1.25), mid = W(-0.035, 0.0, 0.62).add(EYE_UP), top = W(-0.035, 0.36, 0.25).add(EYE_UP);
    const deckEye = DOCK.y + 0.08 + 1.65;
    const pts = [new THREE.Vector3(foot.x, deckEye, COVE.wallZ + 1.5), new THREE.Vector3(foot.x, deckEye, foot.z - 1.2), mid, top, end];
    cine = { curve: new THREE.CatmullRomCurve3(pts, false, "centripetal"), t0: performance.now() / 1000, dur: seconds, onDone, end };
  }
  const _cineLook = new THREE.Vector3(), _cineOut = new THREE.Vector3();
  function updateCine() {
    const u = Math.min(1, (performance.now() / 1000 - cine.t0) / cine.dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const pos = cine.curve.getPointAt(e);
    camera.position.copy(pos); st.pos.copy(pos);
    // look a little ahead along the path; over the last stretch turn to look out over the sea (the station's own gaze)
    cine.curve.getPointAt(Math.min(1, e + 0.07), _cineLook); _cineLook.y -= 0.25;
    _cineOut.copy(cine.end).add(new THREE.Vector3(0, Math.tan(STATIONS.sea.pitch ?? 0) * 20, 20));
    _cineLook.lerp(_cineOut, THREE.MathUtils.smoothstep(e, 0.7, 1));
    camera.lookAt(_cineLook);
    if (u >= 1) { st.yaw = STATIONS.sea.yaw; st.pitch = STATIONS.sea.pitch; const f = cine.onDone; cine = null; if (f) f(); }
  }
  // ZONES (owner, 2026-10-09: "don't draw things we can't see"): in rounds 1-3 (the courtyard stations) the whole COVE behind the sea
  // wall is out of sight — measured: at the bass guns it was still being drawn, past the walls — so it isn't drawn at all; the
  // to-do's "gate" view, the altar and the editor show everything. (At the altar the courtyard is behind you: the camera already
  // skips it.) Hidden things cast no shadow, so the static sun shadows are redrawn on each change.
  const COURT_STATIONS = new Set(["drums", "bass", "treble"]);
  let zoneHidden = null; const zoneHid = new Set();
  const NOZONE = new URLSearchParams(location.search).has("nozone");
  function applyZone() {
    if (NOZONE) return;   // ?nozone — measuring what the zone rule saves
    const hideCove = COURT_STATIONS.has(station) && !fly.on && !cine;   // never during a flight
    if (hideCove === zoneHidden) return;
    zoneHidden = hideCove;
    const inCove = (o) => { o.updateMatrixWorld(); return o.getWorldPosition(_zp).z > COVE.wallZ; };
    if (hideCove) {   // hide what's in the cove and visible now — and remember exactly those (what HE hid stays hidden)
      const take = (o) => { if (o.visible) { o.visible = false; zoneHid.add(o); } };
      for (const o of scene.children) {
        if (["cove", "sea", "hydra", "acid", "altar-kit"].includes(o.name)) take(o);
        else if (o.name === "props" || o.name === "braziers") { for (const c of o.children) if (inCove(c)) take(c); }
        else if (o.name.startsWith("station-") && inCove(o)) take(o);   // round 4's gun station on the altar
      }
    } else { for (const o of zoneHid) o.visible = true; zoneHid.clear(); }
    if (typeof refreshSunShadow === "function") refreshSunShadow();
    bootlog("zone", { hideCove });
  }
  const _zp = new THREE.Vector3();
  const hydra = createHydra(scene, { origin: new THREE.Vector3(0, -4.6, DOCK.z1 + 7.5), target: BOOTH_POS.clone().setY(2.2), sea });   // close (owner): bases under the water, necks stretched, never reaching further
  if (new URLSearchParams(location.search).has("hydra")) hydra.rise();
  { const b = new URLSearchParams(location.search).get("bite");   // dev: &bite=1 bites every 3 s, heads in turn; &bite=hold freezes the middle head at full lunge
    if (b === "hold") hydra.holdLunge(1);
    else if (b) { let k = 0; setInterval(() => hydra.bite(k++ % 3, performance.now() / 1000), 3000); } }
  const melodyStations = { bass: createStation(scene, "bass", { lamp: !MOBILE, slots: KIT.bass }), treble: createStation(scene, "treble", { lamp: !MOBILE, slots: KIT.treble }) };
  bootlog("courtyard: done");
  // the reflecting pool (drawn with the fx layer: after the scene, so the
  // AO's extra scene render doesn't re-render its mirror a second time)
  bootlog("pool: start");
  const waterPool = createPool(scene, { bottomMap: courtyard.userData.flagsMap, layer: FX_LAYER, resolution: 0.5, cheap: LOW || MOBILE });   // (10-08: phones get the plain shiny water — the mirror redrew the scene: 452 draw calls)
  // the water goes INSIDE the fountain (owner, 2026-10-07). The basin, measured from Fountain.glb: a rounded
  // rectangle 84% x 78% of the model's footprint, its water a third of the way up (the rim is at 38%)
  courtyard.userData.fountain.then(({ pivot, size }) => waterPool.fitInto(pivot, { hx: size.w / 2 * 0.84, hz: size.d / 2 * 0.78, y: size.h * 0.33, corner: size.d * 0.08 }));

  // drums
  const drumMat = [];
  const drumPos = [];
  const drumFace = [];
  const drumLabels = [], drumKeys = [];
  let labelsOff = false;   // tablets: no letters on the drums (owner, 2026-10-04)
  const drumLabelMats = [];
  // the countdown numbers: fat, a thick dark outline and a ring — 1 red, 2 orange, 3 yellow;
  // 4-9 pale (only shown small, for the NEXT strike queued on the same target)
  const COUNT_COL = { 1: "#ff4a3a", 2: "#ffa53a", 3: "#ffe45a" };
  const COUNT_N = [null, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
    const d = String(n), col = COUNT_COL[n] || "#e8dccb";
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2);
    g.fillStyle = "rgba(20,8,4,0.55)"; g.fill();
    g.lineWidth = 9; g.strokeStyle = col; g.stroke();
    g.font = "900 92px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineJoin = "round"; g.lineWidth = 16; g.strokeStyle = "#1a0802"; g.strokeText(d, 64, 70);
    g.fillStyle = col; g.fillText(d, 64, 70);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  })];
  const labelGeo = new THREE.PlaneGeometry(0.2, 0.2);   // ~half a 0.19-0.2 m drumhead
  const labelTex = (key) => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 128, 128);
    g.font = `bold ${key.length > 1 ? 62 : 88}px sans-serif`;   // "LB" / "RT" (pad buttons) fit too
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
    drumKeys.push(lane.key || "?");   // the keyboard letter, to restore after a controller's buttons
    // COUNTDOWN (owner, 2026-10-03: "telling when to hit the drums is really hard"):
    // a big outlined 3, 2, 1 just above the letter, one per beat; the hit is the beat after 1

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

  // ---- TARGETS 6..37: the melody bars (bass 6-21, treble 22-37) ride the same
  // per-lane systems as the drums — face, size, colour, arc, archers, visibility
  const N_T = 6 + 2 * BARS;
  const BAR_HEX = { bass: "#e8963c", treble: "#9fd4ff" };
  const BAR_TARGET = { radius: 0.07, depth: 0.04, upright: false, bar: true };
  const stationOf = (i) => (i < 6 ? "drums" : i < 6 + BARS ? "bass" : "treble");
  const TARGET = (i) => (i < 6 ? LANES3D[i] : BAR_TARGET);
  // the guns: 16 colours round the wheel per station (top row lighter), bass and treble offset
  const gunHex = (i) => { const slot = (i - 6) % BARS, c = new THREE.Color();
    c.setHSL(((slot % PER_ROW) / PER_ROW + (stationOf(i) === "treble" ? 1 / 16 : 0)) % 1, 0.95, slot >= PER_ROW ? 0.66 : 0.52);
    return "#" + c.getHexString(); };
  function laneHex(i) { return i < 6 ? (colors[drumOf(i)] || "#888888") : gunHex(i); }
  // each gun's key letter in its lane's colour: a green cart / rocket heads for the green letter
  for (let i = 6; i < N_T; i++) { const b = melodyStations[stationOf(i)].bars[(i - 6) % BARS]; if (b && b.label) b.label.material.color.copy(hexToColor(laneHex(i))); }
  for (const kind of ["bass", "treble"]) {
    for (const b of melodyStations[kind].bars) { drumFace.push(b.top.clone()); drumMat.push(b.mat); }
  }
  // the bars' archers: fixed spots along their own court's roofs, alternating sides
  // the CANNONS' rockets (owner, 2026-10-03: "rockets for the top"): straight down their
  // court on their own lane, lined up with their cannon and spread wider far away, like the drums'
  for (let i = 6; i < N_T; i++) {
    const name = stationOf(i), b = melodyStations[name].bars[(i - 6) % BARS], yaw = STATIONS[name].yaw;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(fwd.z * -1, 0, fwd.x);
    const lat = b.top.clone().sub(new THREE.Vector3(0, 0, 0.3)).dot(right);
    SPAWNS[i] = new THREE.Vector3(0, 0, 0.3).addScaledVector(fwd, 28).addScaledVector(right, lat * 3.5).setY((i - 6) % BARS < PER_ROW ? 2.4 : 3.8);   // bottom row low, top row high
    ARC_LIFT[i] = 0.9;
  }

  // DRUM STANDS (placeholder): a post from the ground to each drum's body
  const standMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.8, metalness: 0.2 });
  const stands = LANES3D.map((L) => {
    const g = new THREE.Group();
    const bottom = L.upright ? L.y - L.radius : L.y - L.depth / 2;      // where the drum body starts
    const zBack = L.upright ? L.z - L.depth * 0.3 : L.z;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, bottom, 10), standMat);
    post.position.set(L.x, bottom / 2, zBack);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 18), standMat);
    foot.position.set(L.x, 0.015, zBack);
    for (const m of [post, foot]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    scene.add(g);
    return g;
  });

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
  // THE DEFENSE you build by playing: the shield dome and the cannons (defense.js)
  const defense = createDefense(scene, { fireTexture, layer: FX_LAYER, glowLayer: SHIELD_LAYER, cheap: POTATO });
  // the FIRE BASINS that light the town (braziers.js): real lights only on the nearest few
  const braziers = createBraziers(scene, { fireSim, fireTexture, flameTexture, layer: FX_LAYER,
    lights: LOW ? 0 : MOBILE ? 2 : 4, particles: !LOW, rate: MOBILE ? 0.5 : 1 });
  batcher = createBatcher(scene, { roots: () => [courtyard, scene.getObjectByName("braziers")], maxZ: COVE.wallZ,
    skip: (o) => o.userData && o.userData.editId === "gate-sea" });   // the sea gate rises at the big to-do
  // THE LIGHTING KNOBS (owner, 2026-10-08: "may as well put lighting settings in the editor") — the dev editor's Lighting
  // section drives these live; saved in the layout file as "_lighting" and applied when the layout loads
  const LIGHT_DEFAULTS = { sun: 2.6, sunHeight: 9.5, shadowBlur: 5, sky: 0.26, reflections: 0.25, exposure: 1.15, fires: 1 };
  const lighting = {
    defaults: LIGHT_DEFAULTS, values: { ...LIGHT_DEFAULTS },
    set(v) {
      Object.assign(this.values, v); const L = this.values;
      AFTERGLOW = L.sun; sunAt(L.sunHeight); afterglow.shadow.radius = L.shadowBlur; skyFill.intensity = L.sky;
      scene.environmentIntensity = L.reflections; renderer.toneMappingExposure = L.exposure; braziers.lightScale = L.fires;
      refreshSunShadow();
    },
  };
  // scenery ADDED in the dev editor (props.js): rebuilt from the saved layout on every load
  const props = createProps(scene, { braziers });
  editsLoaded.then((ed) => props.spawnSaved(ed)).then((list) => list && list.length && bootlog("props", { n: list.length }));
  // THE ARMY down the courts (troops.js): fwd = down the court a station faces, right = across it
  const courtOf = (side) => { const yaw = STATIONS[side].yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    return { fwd: new THREE.Vector3(fx, 0, fz), right: new THREE.Vector3(-fz, 0, fx) }; };
  const COURTS = { bass: courtOf("bass"), treble: courtOf("treble") };
  const troops = createTroops(scene, { court: (side) => COURTS[side], center: new THREE.Vector3(0, 0, 0.3), layer: FX_LAYER, fireTexture, models: !LOW });   // cheap tiers: box soldiers
  // THE LIGHTNING GUN (treble, owner 2026-10-04): crystal hits arc into the orb, which fills
  // with charge; charged, a jagged BOLT leaps from the orb to the boss
  const LG = melodyStations.treble.lightning;
  const lgState = { charge: 0, shown: 0, now: 0, boltT0: -1e9, from: new THREE.Vector3(), to: new THREE.Vector3() };
  const jagLine = (n) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd8ecff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    l.layers.set(FX_LAYER); l.visible = false; l.frustumCulled = false; scene.add(l); return l; };
  const _ja = new THREE.Vector3(), _jb = new THREE.Vector3(), _jc = new THREE.Vector3();
  const jag = (line, from, to, amp) => {   // a fresh zig-zag between two points, every frame
    const pos = line.geometry.attributes.position, n = pos.count;
    _ja.subVectors(to, from); _jb.set(-_ja.z, 0, _ja.x).normalize(); _jc.crossVectors(_ja, _jb).normalize();
    for (let i = 0; i < n; i++) { const f = i / (n - 1), w = Math.sin(Math.PI * f) * amp;
      pos.setXYZ(i, from.x + _ja.x * f + (_jb.x * (Math.random() - 0.5) + _jc.x * (Math.random() - 0.5)) * w,
        from.y + _ja.y * f + (_jb.y * (Math.random() - 0.5) + _jc.y * (Math.random() - 0.5)) * w,
        from.z + _ja.z * f + (_jb.z * (Math.random() - 0.5) + _jc.z * (Math.random() - 0.5)) * w); }
    pos.needsUpdate = true;
  };
  const bolts3 = [jagLine(30), jagLine(30), jagLine(30)];   // three strands make it read as thick
  const arcs = Array.from({ length: 6 }, () => ({ line: jagLine(10), t0: -1e9, from: new THREE.Vector3() }));
  const crystalPulse = new Float32Array(BARS);
  const strikeFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTexture, color: 0xcfe9ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  strikeFlash.layers.set(FX_LAYER); strikeFlash.visible = false; scene.add(strikeFlash);
  // BLOOM the lightning (owner, 2026-10-04): everything electric also sits on the shield's magic-bloom channel
  for (const o of [LG.orb, ...LG.rings, ...bolts3, ...arcs.map((a) => a.line), strikeFlash]) o.layers.enable(SHIELD_LAYER);
  for (const b of melodyStations.treble.bars) if (b.crystal && b.parts) for (const m of b.parts) m.layers.enable(SHIELD_LAYER);
  // THE CRYSTALS (owner, 2026-10-04): the mortar fire CHARGES them (the game says how full); a
  // READY one glows hard, pulsing, and counts 3, 2, 1 to its moment inside itself; struck, it flares
  let crystalState = [{ charge: 0, ready: false, moment: 0 }, { charge: 0, ready: false, moment: 0 }];
  const crystalNums = melodyStations.treble.bars.map((b) => { if (!b.crystal || b.stub) return null;
    const n = new THREE.Sprite(new THREE.SpriteMaterial({ map: COUNT_N[3], transparent: true, depthWrite: false, depthTest: false, fog: false }));
    n.renderOrder = 22; n.layers.set(FX_LAYER); n.visible = false; n.position.copy(b.centre); n.position.y += 0.02; scene.add(n); return { s: n, n: 0, at: 0 }; });
  function updateCrystalCues(heardNow) {
    const bars = melodyStations.treble.bars;
    for (const [side, k] of [[0, PER_ROW], [1, PER_ROW + 4]]) {
      const b = bars[k], cn = crystalNums[k], st = crystalState[side];
      if (!b || !b.crystal || !cn) continue;
      const dt = st.ready ? st.moment - heardNow : Infinity;
      const pulse = st.ready ? 0.5 + 0.5 * Math.sin(heardNow * 9) : 0;
      b._cueGlow = 0.9 * st.charge + (st.ready ? 0.8 + 0.6 * pulse : 0);
      const n = 0;   // NO COUNTDOWN (owner, 2026-10-07): a ready crystal just glows; strike it whenever
      if (n !== cn.n) { cn.n = n; cn.at = heardNow; if (n) cn.s.material.map = COUNT_N[Math.min(3, n)]; }
      cn.s.visible = n > 0;
      if (n) { cn.s.material.opacity = Math.min(1, dt / (0.4 * beatDur)); cn.s.scale.setScalar(0.3 * (1 + 0.4 * Math.exp(-9 * (heardNow - cn.at)))); }
    }
  }
  function updateLightning(dt) {
    const S = lgState; S.now += dt;
    S.shown += (S.charge - S.shown) * Math.min(1, dt * 8);
    const boltAge = S.now - S.boltT0, bolting = boltAge < 0.35;
    LG.orb.scale.setScalar(1 + 0.4 * S.shown);
    LG.coilMat.emissive.setRGB(0.1 * S.shown, 0.35 * S.shown, 1.0 * S.shown);
    LG.orbMat.emissiveIntensity = 0.03 + 1.6 * S.shown + (bolting ? 2.0 : 0);   // chrome at rest; lit by charge, not a white-out (the bloom channel doubles it)
    const bars = melodyStations.treble.bars;
    for (let k = PER_ROW; k < BARS; k++) { crystalPulse[k] *= Math.exp(-dt * 6); if (bars[k].crystal && !bars[k].stub) bars[k].mat.emissiveIntensity = 0.25 + 1.3 * (bars[k]._cueGlow || 0) + 1.5 * crystalPulse[k] + 0.2 * S.shown; }   // gentler (owner: the glow was too strong)
    for (const a of arcs) { const age = S.now - a.t0; if (age > 0.25) { a.line.visible = false; continue; } a.line.visible = true; jag(a.line, a.from, LG.pos, 0.25); a.line.material.opacity = 1 - age / 0.25; }
    for (const b of bolts3) { if (!bolting) { b.visible = false; continue; } b.visible = true; jag(b, S.from, S.to, 1.4); b.material.opacity = 1 - boltAge / 0.35; }
    strikeFlash.visible = bolting;
    if (bolting) { strikeFlash.position.copy(S.to); strikeFlash.scale.setScalar(1.5 + 5 * boltAge / 0.35); strikeFlash.material.opacity = 0.8 * (1 - boltAge / 0.35); }
  }

  // GUN CUES (owner, 2026-10-03: arrows can't reach the guns through the shield):
  // a CANNON's fuse burns down — the spark reaches the touch-hole on the beat;
  // a MORTAR's shell drops in from above, landing in the barrel on the beat
  // ON THE SONG'S BEAT (owner, 2026-10-03: "signals in the timing of the current song"):
  // every cue lasts a number of BEATS, not seconds, and kicks on each beat of the song
  // as it counts in — "one, two, HIT" — so a fast song gets quick fuses, a slow one slow
  let beatFirst = 0, beatDur = 0.6, beatKick = 0;
  const cueBeats = () => (beatDur < 0.42 ? 4 : 2);   // fast songs: 4 beats, so it's never a blink
  const cueSpan = () => cueBeats() * beatDur;
  // THE LANES: a glowing strip per drum along its arrows' exact path, faded far away,
  // with BEAT BARS sliding down it — a bar reaches the drum on each beat (brighter on
  // the bar's downbeat), so an arrow rides in with a bar under it. Built on first use
  // (the drums' faces exist by then).
  const LANE_VERT = `attribute float aF, aS; varying float vF, vS; void main() { vF = aF; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const LANE_FRAG = `uniform vec3 uColor; uniform float uNow, uFirst, uBeat, uA, uOn, uHot; varying float vF, vS;
    void main() {
      float b = (uNow + (1.0 - vF) * uA - uFirst) / uBeat;           // which beat reaches the drum when this point does
      float d = abs(fract(b + 0.5) - 0.5) * uBeat / uA;               // distance to the nearest bar, in path units
      float down = step(0.5, 1.0 - abs(mod(floor(b + 0.5), 4.0)));    // the bar's downbeat
      float bar = 0.0;   // no bars: the rocket arrow coming down the lane is the cue (owner)
      float fade = smoothstep(0.0, 0.35, vF) * (1.0 - smoothstep(0.0, 1.0, abs(vS)));   // soft, blurred edges (owner)
      float a = fade * (0.16 + 0.22 * uHot + bar * 1.6) * uOn;
      gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.6 * bar) * (1.0 + 1.5 * bar), min(1.0, a));   // the bars run white-hot
    }`;
  let lanes = null;
  // a gun lane's own court: down it, and across it
  const courtFwd = (name) => { const yaw = STATIONS[name].yaw; return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); };
  const LANE_C = new THREE.Vector3(0, 0, 0.3);
  function buildLane(i, pointAt, W) {
    const N = 48, P = new THREE.Vector3(), Q = new THREE.Vector3(), side = new THREE.Vector3();
    const pos = new Float32Array((N + 1) * 2 * 3), fs = new Float32Array((N + 1) * 2), ss = new Float32Array((N + 1) * 2), idx = [];
    for (let k = 0; k <= N; k++) {
      const f = k / N;
      pointAt(f, P); pointAt(Math.min(1, f + 0.01), Q);
      if (f >= 1) { pointAt(0.99, Q); Q.subVectors(P, Q).add(P); }
      side.subVectors(Q, P).cross(UP).normalize().multiplyScalar(W / 2);
      pos.set([P.x - side.x, P.y - side.y, P.z - side.z, P.x + side.x, P.y + side.y, P.z + side.z], k * 6);
      fs[k * 2] = fs[k * 2 + 1] = f; ss[k * 2] = -1; ss[k * 2 + 1] = 1;
      if (k < N) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aF", new THREE.BufferAttribute(fs, 1));
    g.setAttribute("aS", new THREE.BufferAttribute(ss, 1));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({ vertexShader: LANE_VERT, fragmentShader: LANE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uColor: { value: hexToColor(laneHex(i)) }, uNow: { value: 0 }, uFirst: { value: 0 }, uBeat: { value: 0.6 }, uA: { value: APPROACH_S }, uOn: { value: 0 }, uHot: { value: 0 } } });
    const mesh = new THREE.Mesh(g, m);
    mesh.layers.set(FX_LAYER); mesh.renderOrder = 2; mesh.frustumCulled = false; mesh.visible = false;
    scene.add(mesh);
    return { i, mesh, m, station: i < 6 ? "drums" : stationOf(i), seen: 0 };
  }
  function buildLanes() {
    lanes = [];
    const e = { spawn: null, face: null, laneIdx: 0 };
    const air = (i) => (f, out) => { e.spawn = SPAWNS[i]; e.face = drumFace[i]; e.laneIdx = i; return pathPoint(e, f, out); };
    for (let i = 0; i < N_T; i++) lanes.push(buildLane(i, air(i), i >= 6 ? 0.07 : 0.1));   // one cue everywhere: a rocket down its lane
  }
  function updateLanes(heardNow) {
    if (!lanes) buildLanes();
    for (const L of lanes) {
      const u = L.m.uniforms;
      // something coming down it: an arrow / rocket (drums, cannons) or a cart (mortars)
      let hot = 0;
      for (const e of activeNotes) if (e.laneIdx === L.i && !e.hit && e.time > heardNow) hot = 1;
      if (L.station !== station) L.seen = 0;   // a fresh section: guides start dark
      else if (hot) L.seen = 1;
      // drums: every drum in the song keeps its lane; guns: a lane lights when used, then stays as a faint guide
      const isCrystal = L.i >= 6 + BARS + PER_ROW;   // the boss's crystals: no lane (they aren't song notes)
      const want = station !== L.station || !drumVisible[L.i] || isCrystal ? 0 : L.i < 6 ? 1 : L.seen ? (hot ? 1 : 0.45) : 0;
      u.uOn.value += (want - u.uOn.value) * Math.min(1, fireDt * 3);
      L.mesh.visible = u.uOn.value > 0.01;
      u.uHot.value += (hot - u.uHot.value) * Math.min(1, fireDt * 6);
    }
  }
  function updateBeatKick(heardNow) {
    const s = (heardNow - beatFirst) / beatDur;
    beatKick = Math.exp(-7 * (s - Math.floor(s)));   // 1 on the beat, dying away before the next
  }
  // FIRING TELL (owner, 2026-10-04: "hard to notice the cannons going"): when a shot leaves, a
  // bright muzzle flash, the barrel kicks back and glows hot for a moment
  const muzzleFlashes = Array.from({ length: 10 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTexture, color: 0xffe0a0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false })); s.layers.set(FX_LAYER); s.visible = false; scene.add(s); return s; });
  const firing = [];   // { at, laneIdx }: shots that will leave at `at`
  function gunKick(b) {
    if (!b.mesh.userData.home) { b.mesh.userData.home = b.mesh.position.clone(); b.mesh.userData.axis = new THREE.Vector3(0, 1, 0).applyEuler(b.mesh.rotation).normalize(); }
    b._kick = 1;
  }
  function updateFiring(heardNow, dt) {
    for (let i = firing.length - 1; i >= 0; i--) {
      if (heardNow < firing[i].at) continue;
      const f = firing.splice(i, 1)[0], name = f.laneIdx < 6 + BARS ? "bass" : "treble", b = melodyStations[name].bars[(f.laneIdx - 6) % BARS];
      if (b) gunKick(b);
    }
    let mi = 0;
    for (const name of ["bass", "treble"]) for (const b of melodyStations[name].bars) {
      if (!b._kick) continue;
      b._kick = Math.max(0, b._kick - dt * 5);   // 0.2 s
      const k = b._kick;
      b.mesh.position.copy(b.mesh.userData.home).addScaledVector(b.mesh.userData.axis, -0.08 * k);   // recoil
      if (b.mat.emissive) b.mat.emissive.setRGB(1.2 * k, 0.5 * k, 0.1 * k);   // the barrel glows hot
      if (mi < muzzleFlashes.length && k > 0.3) { const s = muzzleFlashes[mi++]; s.visible = true; s.position.copy(b.muzzle); s.scale.setScalar(0.45 + 0.9 * (1 - k)); s.material.opacity = (k - 0.3) / 0.7; }
      if (!k) b.mesh.position.copy(b.mesh.userData.home);
    }
    for (; mi < muzzleFlashes.length; mi++) muzzleFlashes[mi].visible = false;
  }
  let gunCues = [], gunCuesTest = null;   // gunCuesTest: harness only
  const _fA = new THREE.Vector3(), _fB = new THREE.Vector3(), _fP = new THREE.Vector3();
  function updateGunCues(heardNow) {
    const SPAN = cueSpan();
    for (const name of ["bass", "treble"]) for (const b of (melodyStations[name] ? melodyStations[name].bars : [])) if (b.buttonMat) b._red = 0;
    for (const c of gunCuesTest || gunCues) {
      const dt = c.time - heardNow, name = c.laneIdx < 6 + BARS ? "bass" : "treble";
      const b = melodyStations[name] && melodyStations[name].bars[(c.laneIdx - 6) % BARS];
      if (!b || !drumVisible[c.laneIdx]) continue;
      // the BUTTON lights red, fading in to full on the beat, then out fast (owner, 2026-10-03)
      if (b.buttonMat) {
        const red = dt >= 0 ? Math.max(0, 1 - dt / SPAN) ** 2 : Math.max(0, 1 + dt / 0.15);
        b._red = Math.max(b._red, dt >= 0 ? red * (0.55 + 0.45 * beatKick) : red);   // a notch brighter on each beat
      }
    }
    for (const name of ["bass", "treble"]) {
      const bars = melodyStations[name] ? melodyStations[name].bars : [];
      for (let j = 0; j < PER_ROW && j < bars.length; j++) {   // one button per column: it glows for whichever gun is due
        const r = Math.max(bars[j]._red || 0, bars[j + PER_ROW] ? bars[j + PER_ROW]._red || 0 : 0);
        if (bars[j].buttonMat) bars[j].buttonMat.emissive.setRGB(2.6 * r, 0.1 * r, 0.04 * r);   // dark red -> bright red
      }
    }
  }
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
  // ROCKET ARROWS (owner, 2026-10-03): the drum notes threaten YOU — an arrow with a
  // rocket tube strapped to its shaft, like the old fire-arrows, flame pouring out the back
  const tubeGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10); tubeGeo.translate(0.042, 0.06, 0);
  const capGeo = new THREE.ConeGeometry(0.03, 0.06, 10); capGeo.translate(0.042, 0.2, 0);
  const TUBE_MAT = new THREE.MeshBasicMaterial({ color: 0x8a1e14, fog: false }), CAP_MAT = new THREE.MeshBasicMaterial({ color: 0x2a1a10, fog: false });
  const _lc = new THREE.Color(), _white3 = new THREE.Color(1, 1, 1);
  const pool = [];
  for (let i = 0; i < 40; i++) {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(shaftGeo, SHAFT_MAT);
    const head = new THREE.Mesh(headGeo, HEAD_MAT);
    const tubeMat = TUBE_MAT.clone();   // its own: painted its lane's colour
    const tube = new THREE.Mesh(tubeGeo, tubeMat), cap = new THREE.Mesh(capGeo, CAP_MAT);
    // its COUNTDOWN rides with it (owner, 2026-10-03: "put the countdown on the rocket")
    const num = new THREE.Sprite(new THREE.SpriteMaterial({ map: COUNT_N[3], transparent: true, depthWrite: false, depthTest: false, fog: false }));
    num.renderOrder = 21; num.layers.set(FX_LAYER); num.visible = false; scene.add(num);
    shaft.castShadow = true; head.castShadow = true;
    group.scale.setScalar(ROCKET_SCALE);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: fireTexture,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    flame.position.set(0.042, -0.07, 0);   // the rocket's exhaust, at the back of the tube
    flame.scale.setScalar(0.45);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false,
      map: flameTexture,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      opacity: 0.25,
    }));
    glow.position.set(0.042, -0.07, 0);
    glow.scale.setScalar(1.4);
    group.add(shaft, head, tube, cap, flame, glow);
    group.visible = false;
    scene.add(group);
    pool.push({
      id: "a" + i,      // fire-simulation emitter id
      group, tubeMat, num, numN: 0,
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
  const drumVisible = new Array(N_T).fill(true);   // drums fade in by part; bars always stand
  const drumMeshes = [];
  const drumFade = [];
  for (let i = 0; i < 6; i++) {
    drumMeshes.push(scene.children.find((o) => o.isMesh && o.material === drumMat[i]));   // THIS drum's mesh (includes() matched drum 0 every time)
    drumFade.push({ active: false, started: 0 });
  }
  const FADE_S = 0.6;
  function setDrumVisible(laneIdx, visible) {
    if (laneIdx >= 6 && laneIdx < N_T) {   // a gun: dimmed when the song never plays it (owner, 2026-10-04)
      drumVisible[laneIdx] = visible;
      const b = melodyStations[stationOf(laneIdx)].bars[(laneIdx - 6) % BARS];
      if (!b) return;
      if (b.stub) return;
      if (!b._base) b._base = { mat: b.mat.color.clone(), btn: b.buttonMat.color.clone() };
      b.mat.color.copy(b._base.mat).multiplyScalar(visible ? 1 : 0.4);
      b.buttonMat.color.copy(b._base.btn).multiplyScalar(visible ? 1 : 0.4);
      b.label.material.opacity = visible ? 1 : 0.22;
      return;
    }
    if (laneIdx < 0 || laneIdx > 5) return;
    stands[laneIdx].visible = visible;
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
      drumLabels[laneIdx].visible = !labelsOff;
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
  const handGeo = new THREE.SphereGeometry(0.055, 20, 14);   // real fist size (it's right in front of you now)
  handGeo.scale(1, 0.8, 1.3);   // slightly squashed fist
  const stickGeo = new THREE.CylinderGeometry(0.013, 0.016, STICK_LEN, 10);
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
  const HAND_REST = [               // close in front of the player: sticks reach the heads
    new THREE.Vector3(-0.66, 0.98, -0.1),   // just outside the kit: letters stay readable
    new THREE.Vector3(0.66, 0.98, -0.1),
  ];
  // rest stick heading: up-forward ~35° from vertical (toward the drums)
  const REST_DIR = new THREE.Vector3(0, Math.cos(35 * Math.PI / 180), -Math.sin(35 * Math.PI / 180));
  const restDir = REST_DIR.clone();   // turns with the station you face
  // where the hands rest at each station: just outside the kit / the bar row
  const HAND_RESTS = {
    drums:  [new THREE.Vector3(-0.66, 0.98, -0.1), new THREE.Vector3(0.66, 0.98, -0.1)],
    gate:   [new THREE.Vector3(0.66, 0.98, 1.6), new THREE.Vector3(-0.66, 0.98, 1.6)],
    bass:   [new THREE.Vector3(0.4, 0.98, BAR_MID_Z - 0.75), new THREE.Vector3(0.4, 0.98, BAR_MID_Z + 0.75)],
    treble: [new THREE.Vector3(-0.4, 0.98, BAR_MID_Z + 0.75), new THREE.Vector3(-0.4, 0.98, BAR_MID_Z - 0.75)],
    sea:    [new THREE.Vector3(0.66, 0.98, BOOTH_POS.z + 0.35), new THREE.Vector3(-0.66, 0.98, BOOTH_POS.z + 0.35)],   // over the booth's faders
  };

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
    if (laneIdx >= 6) return ((laneIdx - 6) % PER_ROW) < PER_ROW / 2 ? 0 : 1;   // bars: a row's left half left hand, right half right
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
    if (laneIdx < 0 || laneIdx >= N_T) return;
    const h = vrOn() ? (vrLastStick ?? handFor(laneIdx)) : handFor(laneIdx);
    const hand = hands[h];
    const face = drumFace[laneIdx];
    if (vrOn()) {                       // the controller owns the pose: just the flash
      hand.last = performance.now();
      if (kind === "HIT") { hand.group.add(hand.flash); hand.flash.position.set(0, STICK_LEN, 0); hand.flash.visible = true; hand.flash.material.opacity = 1; hand.flashT0 = performance.now(); }
      return;
    }
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
  const GHOST_WIND = 0.15, GHOST_RECOIL = REBOUND_MS / 1000, GHOST_OPACITY = 1.0;
  function ghostMaterial(color) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color.clone() }, uOpacity: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
          gl_FragColor = vec4(uColor * (0.6 + 2.4 * f), uOpacity * (0.3 + 0.7 * f)); }`,   // bright enough for the dusk scene
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }
  const GHOST_SIDE = [0, 0, 1, 0, 1, 1];   // left: hat, snare, kick; right: crash, low tom, high tom
  const ghostHands = [];
  for (let i = 0; i < N_T; i++) {
    const mat = ghostMaterial(hexToColor(laneHex(i)));
    const group = new THREE.Group();
    group.add(new THREE.Mesh(handGeo, mat), new THREE.Mesh(stickGeo, mat));
    group.visible = false;
    scene.add(group);
    // each ghost hovers at ITS OWN drum (above and in front of the head), so
    // the whole band's ghosts can play at once without piling onto one spot
    // (they all shared the player's rest pose and read as a single hand)
    const L = TARGET(i);
    const sideOf = i < 6 ? 0 : stationOf(i) === "bass" ? 1 : -1;   // bars: the player stands on the -x (bass) / +x (treble) side
    const rest = drumFace[i].clone().add(L.bar
      ? new THREE.Vector3(-sideOf * 0.32, 0.3, 0)
      : L.upright
      ? new THREE.Vector3((GHOST_SIDE[i] ? 0.12 : -0.12), 0.3, 0.5)
      : new THREE.Vector3((GHOST_SIDE[i] ? 0.1 : -0.1), 0.5, 0.3));
    // impact pose, computed once exactly like strike(): stick from rest toward the face
    const dir = drumFace[i].clone().sub(rest).normalize();
    const impact = drumFace[i].clone().addScaledVector(dir, -STICK_LEN);
    // poised like a drummer: at rest the stick points at its own drum (tip just
    // over the head); the wind-up tips it back and up
    const restDir = dir.clone().lerp(UP, 0.35).normalize();
    const windDir = UP.clone().addScaledVector(dir, -0.45).normalize();
    ghostHands.push({ group, mat, rest, dir, impact, restDir, windDir, pulsedAt: -1 });
  }
  const _gDir = new THREE.Vector3(), _gPos = new THREE.Vector3();

  function updateGhostHands(heardNow, ghosts) {
    for (let i = 0; i < N_T; i++) {
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
        _gPos.copy(g.rest); _gPos.y += 0.12 * vel * e;
        g.group.position.copy(_gPos);
        _gDir.copy(g.restDir).lerp(g.windDir, e * vel).normalize();
        g.group.quaternion.setFromUnitVectors(UP, _gDir);
        g.mat.uniforms.uOpacity.value = GHOST_OPACITY * e;
      } else {
        // impact at T, then the same recoil as the player's hands
        const p = Math.min(1, (heardNow - T) / GHOST_RECOIL);
        const e = 1 - (1 - p) * (1 - p);
        _gPos.copy(g.impact).lerp(g.rest, e);
        _gPos.y += 0.16 * Math.sin(Math.PI * e);
        g.group.position.copy(_gPos);
        _gDir.copy(g.dir).lerp(g.restDir, e).normalize();
        g.group.quaternion.setFromUnitVectors(UP, _gDir);
        g.mat.uniforms.uOpacity.value = GHOST_OPACITY * (1 - 0.7 * e);
        if (g.pulsedAt !== T) {   // the drum answers the ghost's hit, softly
          g.pulsedAt = T;
          const dm = drumMat[i];
          if (dm && dm.emissive) {
            dm.emissive.copy(hexToColor(laneHex(i)));
            dm.emissiveIntensity = Math.max(dm.emissiveIntensity || 0, 0.12 * vel);   // ghosts glow gently: live hits stand out
            const t0 = performance.now();
            const tick = () => { const q = (performance.now() - t0) / 150;
              if (q >= 1) { dm.emissiveIntensity = 0; return; }
              dm.emissiveIntensity = Math.min(dm.emissiveIntensity, 0.12 * vel * (1 - q)); requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
          }
        }
      }
    }
  }

  function updateHands(now) {
    for (const hand of hands) {
      if (!hand.active || vrOn()) continue;
      const t = now - hand.t0;
      if (t >= REBOUND_MS) {
        hand.active = false;
        hand.group.position.copy(hand.rest);
        hand.group.quaternion.setFromUnitVectors(UP, restDir);
      } else {
        const p = Math.min(1, t / REBOUND_MS);
        const e = 1 - (1 - p) * (1 - p);   // ease-out
        const overshoot = 0.16 * Math.sin(Math.PI * e);   // slight upward rebound
        _hPos.copy(hand.startPos).lerp(hand.rest, e);
        _hPos.y += overshoot;
        hand.group.position.copy(_hPos);
        _hDir.copy(hand.startDir).lerp(restDir, e);
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
          s.sprite.material.color.copy(hexToColor(laneHex(laneIdx)));
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
    // the blast is sized to what was hit: a bar is a third of a drum, and sits
    // close to the eye (a drum-sized flash on a bar blew out the screen)
    const S = P * Math.min(1, TARGET(laneIdx).radius / 0.19);
    const face = drumFace[laneIdx];
    fireBurst(face, S);
    // the fireball: blown out of the head toward the player
    fireSim.burst(face, S, TARGET(laneIdx).upright ? { x: 0, y: 0.2, z: 1 } : { x: 0, y: 1, z: 0.3 });
    const drumColor = hexToColor(laneHex(laneIdx));

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
      fl.power = S;
    }

    // 2. SHOCKWAVE — thin additive ring on the drumhead plane,
    //    radius r0 -> 3*r0 over 300 ms, opacity 1 -> 0.
    let sw = null;
    for (const w of shockwaves) if (!w.active) { sw = w; break; }
    if (sw) {
      sw.active = true;
      sw.t0 = heardNow;
      sw.laneIdx = laneIdx;
      sw.r0 = TARGET(laneIdx).radius;
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
  for (let i = 0; i < N_T; i++) {
    const color = hexToColor(laneHex(i));
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
    rings.push({ mesh: ring, radius: TARGET(i).radius });

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
    glow.scale.setScalar(2.2 * TARGET(i).radius);
    glow.visible = false;
    scene.add(glow);
    firelights.push({ glow, radius: i < 6 ? TARGET(i).radius : 0.13, base: hexToColor(laneHex(i)).clone() });   // a gun's halo: drum-like, on its button
  }

  // BUTTON FRAMES: a glowing outline round each column's shared button (owner, 2026-10-04: one
  // box per column, not a mortar's and a cannon's stacked) — the guns' version of the drums' charge light
  const barFrames = [];   // PER_ROW per station: the bottom-row bar carries its column's frame
  for (const kind of ["bass", "treble"]) {
    for (const b of melodyStations[kind].bars.slice(0, PER_ROW)) {
      const hx = b.radius + 0.01, hz = b.radius + 0.01, pad = 0.028, gap = 0.006;
      const shape = new THREE.Shape([[-hx - pad, -hz - pad], [hx + pad, -hz - pad], [hx + pad, hz + pad], [-hx - pad, hz + pad]].map(([x, y]) => new THREE.Vector2(x, y)));
      shape.holes.push(new THREE.Path([[-hx - gap, -hz - gap], [-hx - gap, hz + gap], [hx + gap, hz + gap], [hx + gap, -hz - gap]].map(([x, y]) => new THREE.Vector2(x, y))));
      const frame = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
        color: hexToColor(BAR_HEX[kind]), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      // flat on the button's face
      frame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.normal);
      frame.position.copy(b.top).addScaledVector(b.normal, 0.004);
      frame.layers.set(FX_LAYER);
      frame.visible = false;
      scene.add(frame);
      barFrames.push(frame);
    }
  }
  const _red = new THREE.Color(0xff1408);
  const laneCol = [];   // each lane's colour, built on first use
  const previewAt = new Float64Array(N_T).fill(-1e9);   // when each target last flashed its preview
  const _shot = new THREE.Vector3();
  const pending = new Float32Array(64);   // per target 0..1: "coming up" (set by the game)

  // path point p(f): lerp(spawn, face, f) + the parabolic arc lift.
  // Written into `out`; reuses module temps, allocates nothing.
  function pathPoint(e, f, out) {
    out.copy(e.spawn).lerp(e.face, f);
    out.y += ARC_LIFT[e.laneIdx] * 4 * f * (1 - f);
    return out;
  }

  // DYNAMIC RESOLUTION (10-09, stolen from the big engines): when the frame runs slow the game draws fewer pixels and stretches
  // them (down to 60% of the tier's own sharpness), and climbs back when the frame keeps up again. ?resscale=0.7 pins it (testing).
  const BASE_PR = renderer.getPixelRatio(), RES_PIN = +new URLSearchParams(location.search).get("resscale") || 0;
  let resScale = RES_PIN || 1, resMs = 0, resN = 0, resGood = 0, resLast = performance.now();
  function setResScale(v) {
    resScale = v; const pr = BASE_PR * v;
    renderer.setPixelRatio(pr); if (composer) composer.setPixelRatio(pr); if (shieldGlow) shieldGlow.setPixelRatio(pr);
    resize(); bootlog("resscale", { scale: +v.toFixed(2), pr: +pr.toFixed(2) });
  }
  if (RES_PIN) setTimeout(() => setResScale(RES_PIN), 0);
  function dynRes() {
    const now = performance.now(), dt = now - resLast; resLast = now;
    if (RES_PIN || renderer.xr.isPresenting || dt > 100) return;   // pinned, in a headset, or the tab was away
    resMs += dt; if (++resN < 90) return;
    const avg = resMs / resN; resMs = 0; resN = 0;
    if (avg > 22 && resScale > 0.6) { resGood = 0; setResScale(Math.max(0.6, resScale * 0.85)); }        // under ~45 fps: fewer pixels
    else if (avg < 18 && resScale < 1) { if (++resGood >= 3) { resGood = 0; setResScale(Math.min(1, resScale / 0.85)); } }   // keeping up: back toward sharp
    else resGood = 0;
  }
  function resize() {
    if (renderer.xr.isPresenting) return;   // the headset owns the size in VR
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    if (composer) { composer.setSize(w, h); gtao.setSize(w, h); bloom.setSize(w, h); if (shieldGlow) shieldGlow.setSize(w, h); }
    camera.aspect = w / h;
    fitFov();
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
    fireSim.forget(e.id);
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
  // and thud into the far courtyard ground (beyond the pool), then burn out. They
  // carry NO lane halo, no charge light, no timing — only playable arrows do,
  // so the player can always tell which arrows are theirs.
  const DECOY_N = 36;
  const FLOAT_S = 5;   // seconds a doused arrow floats before it sinks
  // a doused arrow is charred wood, lit by the scene like everything else
  const CHAR_MAT = new THREE.MeshStandardMaterial({ color: 0x2a1d16, roughness: 0.9 });
  const decoys = [];
  for (let i = 0; i < DECOY_N; i++) {
    const group = new THREE.Group();
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, map: fireTexture,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    flame.position.set(0, 0.3, 0);
    const shaft = new THREE.Mesh(shaftGeo, SHAFT_MAT), head = new THREE.Mesh(headGeo, HEAD_MAT);
    group.add(shaft, head, flame);
    group.visible = false;
    scene.add(group);
    decoys.push({ id: "d" + decoys.length, group, flame, shaft, head, active: false, t0: 0, dur: 3, arc: 6,
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
    d.arc = 2.5 + Math.random() * 4;
    if (Math.random() < 0.3) {             // from the top of the far building
      d.from.set((Math.random() * 2 - 1) * FAR_WALL.halfWidth, FAR_WALL.top, FAR_WALL.z);
    } else {                               // from either colonnade roof
      const side = Math.random() < 0.5 ? -1 : 1;
      d.from.set(side * (ARCHER_ROOF_X + Math.random() * 1.5), ARCHER_ROOF_Y,
        ARCHER_ROOF_Z[0] + Math.random() * (ARCHER_ROOF_Z[1] - ARCHER_ROOF_Z[0]));
    }
    d.inWater = false;
    if (Math.random() < 0.25) {
      // into the pool: it'll hiss out and float
      // the FAR half of the pool (owner, 2026-10-03: decoys keep well back)
      const zMid = (POOL.z0 + POOL.z1) / 2;
      d.to.set(POOL.x0 + 0.4 + Math.random() * (POOL.x1 - POOL.x0 - 0.8), POOL.y,
        POOL.z0 + 0.4 + Math.random() * (zMid - POOL.z0 - 0.4));
    } else {
      // a ground spot well back, beyond the pool (owner, 2026-10-03) — never near the player
      for (let tries = 0; tries < 20; tries++) {
        d.to.set(-5 + Math.random() * 10, 0, -34 + Math.random() * 15);   // the far courtyard paving
        const nearDrums = Math.abs(d.to.x) < 1.6 && d.to.z > -2.4 && d.to.z < 2.6;
        if (!nearDrums && !poolContains(d.to.x, d.to.z, -0.5)) break;
      }
    }
    d.group.visible = true;
    d.flame.material.opacity = 1;
    d.shaft.material = SHAFT_MAT; d.head.material = HEAD_MAT;   // burning again (it may have been doused last time)
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
        fireSim.trail(d.id, _dP, Math.min(far, 3));
      } else {
        // stuck in the ground, burning out over 1.2 s
        if (d.landed < 0) {
          d.landed = heardNow;
          fireSim.forget(d.id);
          d.group.position.copy(d.to);          // head buried at the landing spot
          if (poolContains(d.to.x, d.to.z)) {
            // FIRE MEETS WATER: hiss of steam, rings across the pool, flame out
            d.inWater = true;
            fireSim.steam(d.to, 1);
            waterPool.addRipple(d.to.x, d.to.z, 1);
            d.flame.material.opacity = 0;
            d.shaft.material = CHAR_MAT; d.head.material = CHAR_MAT;
            d.yaw = Math.random() * Math.PI * 2;
            d.drift = { x: (Math.random() - 0.5) * 0.12, z: (Math.random() - 0.5) * 0.12 };
            d.nextBobRing = heardNow + 1.2;
          }
        }
        if (d.inWater) {
          // the dead arrow floats: lies flat, bobs, drifts, then sinks
          const t = heardNow - d.landed;
          if (t >= FLOAT_S) { d.active = false; d.group.visible = false; continue; }
          const sink = Math.max(0, (t - (FLOAT_S - 1.5)) / 1.5);          // last 1.5 s: going under
          d.group.position.set(d.to.x + d.drift.x * t, POOL.y + 0.012 + 0.008 * Math.sin(t * 2.4) - 0.12 * sink,
            d.to.z + d.drift.z * t);
          _dT.set(Math.cos(d.yaw + 0.05 * t), 0.06 * Math.sin(t * 1.9), Math.sin(d.yaw + 0.05 * t)).normalize();
          d.group.quaternion.setFromUnitVectors(UP, _dT);
          if (heardNow >= d.nextBobRing && sink === 0) {                  // a small ring as it rocks
            waterPool.addRipple(d.group.position.x, d.group.position.z, 0.18);
            d.nextBobRing = heardNow + 1.4 + Math.random() * 0.8;
          }
          continue;
        }
        const b = (heardNow - d.landed) / 1.2;
        if (b >= 1) { d.active = false; d.group.visible = false; continue; }
        d.flame.material.opacity = (1 - b) * (0.7 + 0.3 * Math.random());
        fireSim.smoulder(d.to, 40 * (1 - b), fireDt);
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
      if (glowy) {
        const shield = o.layers.isEnabled(SHIELD_LAYER);   // keep the shield's bloom channel
        o.layers.set(FX_LAYER);
        if (shield) o.layers.enable(SHIELD_LAYER);
        n++;
      }
    });
    if (n === fxCount) fxSorted = true;   // stable two frames in a row: done
    fxCount = n;
  }
  // ---- FIRE LIGHTS: the flames really light the courtyard --------------------
  // A fixed set of real point lights (fixed count = no shader rebuilds) rides
  // the burning arrows that matter most each frame — brightest and nearest the
  // player — with a flicker; impacts add a short hot burst at the drumhead.
  const FIRE_LIGHTS = LOW ? 0 : MOBILE ? 3 : 6;   // every light costs every pixel on a phone GPU
  const fireLights = [];
  for (let i = 0; i < FIRE_LIGHTS; i++) {
    const l = new THREE.PointLight(0xff8a3a, 0, 7, 2);
    scene.add(l);
    fireLights.push(l);
  }
  const bursts = (LOW ? [] : [0, 1]).map(() => {
    const l = new THREE.PointLight(0xffc68a, 0, 5, 2);
    scene.add(l);
    return { light: l, t0: -1, power: 0 };
  });
  let burstNext = 0;
  function fireBurst(pos, power) {
    if (!bursts.length) return;
    const b = bursts[burstNext++ % bursts.length];
    b.light.position.copy(pos).add(new THREE.Vector3(0, 0.15, 0.25));   // just off the head, toward the player
    b.t0 = performance.now();
    b.power = power;
  }
  const _flamePos = new THREE.Vector3();
  const _cands = [];
  function updateFireLights(now) {
    _cands.length = 0;
    for (const list of [pool, decoys]) {
      for (const a of list) {
        if (!a.group.visible || !a.flame.visible) continue;
        const op = a.flame.material.opacity;
        if (op < 0.05) continue;
        // light rides the shaft behind the head (toward the tail) and never
        // sits below 0.3 m, so an arrow stuck in the ground still lights it
        _flamePos.set(0, -0.2, 0).applyQuaternion(a.group.quaternion).add(a.group.position);
        _flamePos.y = Math.max(_flamePos.y, 0.3);
        const d = _flamePos.distanceTo(camera.position);
        // near its target the light FADES: a point light inches from a surface
        // (shiny bars especially) blows out to white; the impact burst does the
        // flash. Stuck/smouldering arrows keep a dim glow.
        let near = 1;
        if (a.face) {
          const df = _flamePos.distanceTo(a.face);
          near = df >= 0.9 ? 1 : df <= 0.2 ? 0 : (df - 0.2) / 0.7;
          if (a.stuckUntil > 0) near = Math.max(near, 0.15);
        }
        if (op * near < 0.03) continue;
        _cands.push({ x: _flamePos.x, y: _flamePos.y, z: _flamePos.z, op: op * near, score: (op * near) / (1 + d * 0.35) });
      }
    }
    _cands.sort((p, q) => q.score - p.score);
    for (let i = 0; i < FIRE_LIGHTS; i++) {
      const l = fireLights[i], c = _cands[i];
      if (!c) { l.intensity = 0; continue; }
      l.position.set(c.x, c.y, c.z);
      // flicker: two incommensurate wobbles + a little noise, per light
      const f = 0.82 + 0.1 * Math.sin(now * 0.023 + i * 1.7) + 0.06 * Math.sin(now * 0.061 + i) + 0.04 * Math.random();
      l.intensity = 5 * c.op * f;
    }
    for (const b of bursts) {
      if (b.t0 < 0) continue;
      const t = (now - b.t0) / 280;                     // 280 ms: flash then fade
      if (t >= 1) { b.light.intensity = 0; b.t0 = -1; continue; }
      b.light.intensity = 22 * b.power * (t < 0.12 ? t / 0.12 : Math.pow(1 - (t - 0.12) / 0.88, 2));
    }
  }

  // ---- VR ------------------------------------------------------------------
  // The kit is already at standing reach (LANES3D). In a session each
  // controller grip carries one hand (fist + stick); the stick tips are fed to
  // the hit detector every frame, and a hit goes to the game exactly like a
  // key or pad press, with its force from the stick's speed.
  const vrOn = () => renderer.xr.isPresenting;
  let vrLastStick = null;        // which hand made the last VR hit (for its flash)
  let onVrHit = null;            // (laneIdx, force 0..1, timeMs on performance.now())
  let frameT = 0;                // this frame's time (XR frame time in a session)
  const vrHits = createVrHits(Array.from({ length: N_T }, (_, i) => ({
    center: { x: drumFace[i].x, y: drumFace[i].y, z: drumFace[i].z },
    normal: TARGET(i).upright ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 },
    radius: TARGET(i).radius,
  })));
  // stick held like a drumstick: out of the fist, forward and a little down
  const GRIP_DIR = new THREE.Vector3(0, -0.45, -1).normalize();
  const vrPads = [null, null];   // hand index -> XRInputSource gamepad (haptics)
  const deskCam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  for (let g = 0; g < 2; g++) {
    const grip = renderer.xr.getControllerGrip(g);
    scene.add(grip);
    grip.addEventListener("connected", (e) => {
      const h = e.data.handedness === "left" ? 0 : 1;
      const hand = hands[h];
      hand.grip = grip;
      grip.add(hand.group);
      hand.group.position.set(0, 0, 0);
      hand.group.quaternion.setFromUnitVectors(UP, GRIP_DIR);
      vrPads[h] = e.data.gamepad || null;
      grip.userData.hand = h;
    });
    grip.addEventListener("disconnected", () => {
      const h = grip.userData.hand;
      if (h == null) return;
      vrHits.drop(h);
      vrPads[h] = null;
      restHand(h);
      grip.userData.hand = null;
    });
  }
  function restHand(h) {
    const hand = hands[h];
    scene.add(hand.group);
    hand.grip = null;
    hand.group.position.copy(hand.rest);
    hand.group.quaternion.setFromUnitVectors(UP, restDir);
  }
  renderer.xr.addEventListener("sessionstart", () => {
    deskCam.pos.copy(camera.position); deskCam.quat.copy(camera.quaternion);
    camera.layers.enable(FX_LAYER);    // one pass in VR: the fx sprites render with everything
  });
  renderer.xr.addEventListener("sessionend", () => {
    if (composer) camera.layers.disable(FX_LAYER);
    camera.position.copy(deskCam.pos); camera.quaternion.copy(deskCam.quat);
    for (let h = 0; h < 2; h++) { vrHits.drop(h); restHand(h); }
    resize();
  });
  const _tip = new THREE.Vector3();
  function updateVrSticks() {
    for (let h = 0; h < 2; h++) {
      const hand = hands[h];
      if (!hand.grip || !hand.grip.visible) { vrHits.drop(h); continue; }   // lost tracking
      hand.group.updateWorldMatrix(true, false);
      hand.group.localToWorld(_tip.set(0, STICK_LEN, 0));
      for (const hit of vrHits.step(h, _tip, frameT)) {
        if (!stands[hit.head].visible) continue;          // that drum isn't in play yet
        vrLastStick = h;
        const pad = vrPads[h];
        const act = pad && pad.hapticActuators && pad.hapticActuators[0];
        if (act && act.pulse) act.pulse(0.25 + 0.75 * hit.force, 18);
        if (onVrHit) onVrHit(hit.head, hit.force, hit.time);
      }
    }
  }
  /** the game's frame loop: runs on the screen normally and on the headset in VR */
  /** TOUCH: which drum is under screen point (clientX, clientY)? -1 = none.
   *  Generous: nearest drum centre within 1.35x its on-screen radius (min 36 px). */
  const _pc = new THREE.Vector3(), _pr = new THREE.Vector3(), _camRight = new THREE.Vector3();
  function drumScreen(i) {
    const r = canvas.getBoundingClientRect();
    _pc.copy(drumFace[i]).project(camera);
    _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _pr.copy(drumFace[i]).addScaledVector(_camRight, TARGET(i).radius).project(camera);
    const x = r.left + (_pc.x * 0.5 + 0.5) * r.width, y = r.top + (-_pc.y * 0.5 + 0.5) * r.height;
    const rad = Math.abs(_pr.x - _pc.x) * 0.5 * r.width;
    return { x, y, rad };
  }
  /** opts.prefer: target indices to snap to from up to opts.reach px away (phone Easy) */
  function pickDrum(cx, cy, { prefer = null, reach = 0 } = {}) {
    // THE LIGHTNING CRYSTALS first (10-13, on his phone: "no way to set off the crystals"): they're never a note the game wants, so the
    // snap-to-wanted below stole every tap on them for a nearby mortar — and they weren't in the plain pick at all. A tap on one is it.
    if (station === "treble") {
      let best = -1, bestD = Infinity;
      for (const i of [6 + BARS + PER_ROW, 6 + BARS + PER_ROW + 4]) {   // the treble top row's two crystals (main.js hitCrystal)
        const p = drumScreen(i); if (!p) continue;
        const d = Math.hypot(cx - p.x, cy - p.y);
        if (d <= Math.max(44, p.rad * 1.8) && d < bestD) { best = i; bestD = d; }
      }
      if (best >= 0) return best;
    }
    if (prefer && prefer.length) {
      let best = -1, bestD = Infinity;
      for (const i of new Set(prefer)) {
        if (i == null || !drumVisible[i] || stationOf(i) !== station) continue;
        const p = drumScreen(i), d = Math.hypot(cx - p.x, cy - p.y);
        if (d <= Math.max(reach, p.rad * 1.35) && d < bestD) { best = i; bestD = d; }
      }
      if (best >= 0) return best;
    }
    let best = -1, bestD = Infinity;
    for (let i = 0; i < N_T; i++) {
      if (!drumVisible[i] || stationOf(i) !== station) continue;   // only what you're facing
      const p = drumScreen(i);
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d <= Math.max(36, p.rad * 1.35) && d < bestD) { best = i; bestD = d; }
    }
    return best;
  }

  function setLoop(fn) {
    renderer.setAnimationLoop((t) => { frameT = t ?? performance.now(); fn(); });
  }
  /** add the "Enter VR" button (shows "VR not supported" without a headset) */
  function addVrButton(parent = document.body) {
    const b = VRButton.createButton(renderer);
    // only on devices that can do VR: elsewhere it was a grey "WEBXR NOT AVAILABLE" box
    if (navigator.xr && navigator.xr.isSessionSupported) {
      navigator.xr.isSessionSupported("immersive-vr").then((ok) => { if (ok) parent.appendChild(b); }).catch(() => {});
    }
    return b;
  }

  // DEV FLY (owner, 2026-10-07: "a dev mode so I can look around"): a free camera that starts
  // where the seat's camera is. WASD move, Q/E down/up, Shift fast; drag the mouse (or the
  // arrows / a pad's right stick through the look input) to turn. Nothing else changes.
  const fly = { on: false, pos: new THREE.Vector3(), yaw: 0, pitch: 0, keys: new Set(), speed: 5 };   // speed m/s (the mouse wheel sets it)
  // the EDITOR rides along with the fly camera (owner, 2026-10-07: "alter dev mode to be able to move stuff");
  // loaded on first use, so a normal game never pays for it
  let editor = null;
  function setFly(on) {
    fly.on = !!on; fly.keys.clear();
    if (batcher) { if (fly.on) { batcher.dissolve(); refreshSunShadow(); } else { rebatch(); refreshSunShadow(); } }   // the editor sees every piece
    applyZone();   // the editor sees everything; back in play, the zone rule again
    if (fly.on) { fly.pos.copy(camera.position); _eul.setFromQuaternion(camera.quaternion, "YXZ"); fly.yaw = _eul.y; fly.pitch = _eul.x; }
    if (fly.on && !editor) import("../dev/editor.js").then(({ createEditor }) => {
      editor = createEditor({ scene, camera, dom: renderer.domElement, props, lighting, shadowsChanged: () => refreshSunShadow(), log: (step, data) => bootlog("editor " + step, data) });
      editor.setOn(fly.on);
    });
    else if (editor) editor.setOn(fly.on);
  }
  const _fwd = new THREE.Vector3(), _side = new THREE.Vector3();
  function updateFly(dt) {
    const k = fly.keys, speed = (k.has("shift") ? 3 : 1) * fly.speed * Math.min(dt, 0.1);
    fly.yaw -= look.inX * dt * 1.6; fly.pitch = Math.max(-1.5, Math.min(1.5, fly.pitch + look.inY * dt * 1.2));
    _fwd.set(-Math.sin(fly.yaw), 0, -Math.cos(fly.yaw)); _side.set(Math.cos(fly.yaw), 0, -Math.sin(fly.yaw));
    if (k.has("w")) fly.pos.addScaledVector(_fwd, speed); if (k.has("s")) fly.pos.addScaledVector(_fwd, -speed);
    if (k.has("d")) fly.pos.addScaledVector(_side, speed); if (k.has("a")) fly.pos.addScaledVector(_side, -speed);
    if (k.has("e")) fly.pos.y += speed; if (k.has("q")) fly.pos.y -= speed;
    camera.position.copy(fly.pos);
    camera.quaternion.setFromEuler(_eul.set(fly.pitch, fly.yaw, 0, "YXZ"));
  }
  function update(heardNow, upcoming, ghosts = []) {
    { const t = performance.now(); fireDt = Math.min(0.05, (t - fireT) / 1000); fireT = t; }
    defense.update(heardNow, fireDt);
    troops.update(fireDt);
    updateLightning(fireDt);
    updateCrystalCues(heardNow);
    updateFiring(heardNow, fireDt);
    updateBeatKick(heardNow);
    updateGunCues(heardNow);
    // clouds drift; the sunlight follows how much cloud is over the sun (eased over ~1.5 s)
    cloudRot += fireDt * CLOUD_SPEED;
    if (skyMatRef) skyMatRef.uniforms.cloudRot.value = cloudRot;
    sunlit += ((1 - 0.6 * cloudOverSun()) - sunlit) * (1 - Math.exp(-fireDt / 1.5));
    afterglow.intensity = AFTERGLOW * sunlit;
    scene.environmentIntensity = 0.55 * (0.55 + 0.45 * sunlit);   // the sky's glow dims with the cloud too
    if (!vrOn()) {
      // follow the input quickly; with no input, ease back to forward (~0.6 s)
      const active = Math.abs(look.inX) + Math.abs(look.inY) > 0.01;
      const k = 1 - Math.exp(-fireDt * (active ? 8 : 1.6));
      look.x += (look.inX - look.x) * k;
      look.y += (look.inY - look.y) * k;
      // swing toward the current station (~0.7 s), then look-around on top
      const S = STATIONS[station], ks = 1 - Math.exp(-fireDt * 4.5);
      st.yaw += (S.yaw - st.yaw) * ks;
      { const pitchTo = S.pitch ?? PITCH0; st.pitch = st.pitch === undefined ? pitchTo : st.pitch + (pitchTo - st.pitch) * ks; }   // a station may set its own gaze
      st.pos.lerp(S.pos, ks);
      camera.position.copy(st.pos);
      camera.quaternion.setFromEuler(_eul.set((st.pitch ?? PITCH0) + look.y * LOOK_PITCH, st.yaw - look.x * LOOK_YAW, 0, "YXZ"));
      if (cine) updateCine();          // the final battle's opening flight overrides the seat
      if (fly.on) updateFly(fireDt);   // DEV: the free camera overrides the seat
    }
    updateGhostHands(heardNow, ghosts);
    if (!POTATO) updateDecoys(heardNow);   // potato: no decoy volleys
    _frameNo++;
    updateHands(performance.now());
    updateFireLights(performance.now());
    if (vrOn()) updateVrSticks();
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
        e.previewed = false;
        e.group.visible = true;
        // its lane's colour: the tube, a tint in the flame, a small glow (owner: tell them apart, not a big bloom)
        _lc.copy(hexToColor(laneHex(u.laneIdx)));
        e.tubeMat.color.copy(_lc);
        e.flame.material.color.copy(_lc).lerp(_white3, 0.35);
        e.flame.material.opacity = 1;              // a recycled glance left these faded
        e.glow.material.opacity = 0.2;
        e.glow.material.color.copy(hexToColor(laneHex(u.laneIdx)));
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

    // (the countdown rides on each rocket arrow now — owner, 2026-10-03 — not under the drum)
    updateLanes(heardNow);
    // position + flame flicker + retirement
    for (const e of activeNotes) {
      const dt = e.time - heardNow;
      // PREVIEW (owner, 2026-10-04): at the 3 mark its target flashes for an instant — a run of
      // notes flashes its drums 1, 2, 3 in the order you'll hit them three beats later
      if (!e.previewed && !e.hit && dt <= 3 * beatDur) { e.previewed = true; previewAt[e.laneIdx] = heardNow; }
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
          // NEAR: the arrow sticks in the target it was aimed at and burns out
          // over its life (owner, 2026-10-03: arrows flying off elsewhere confused)
          fireSim.forget(e.id);
          const g = (heardNow - e.hitAt) / e.life;
          if (g >= 1) {
            recycle(e);
            continue;
          }
          pathPoint(e, 1, _pA);
          pathPoint(e, 0.99, _pB);
          e.group.quaternion.setFromUnitVectors(UP, _tan.copy(_pA).sub(_pB).normalize());
          e.group.position.copy(e.face).addScaledVector(_tan, -ARROW_TIP);   // stuck IN the face, not through it
          const fade = 1 - g;
          e.flame.material.opacity = fade;
          e.glow.material.opacity = 0.35 * fade;
          continue;
        }
        if (heardNow > e.stuckUntil) {
          if (e.stuckUntil === 0) {
            // first frame past the time: arm the timer, park at the face
            e.stuckUntil = e.time + STUCK_S;
            spawnBurst(e.laneIdx, heardNow, 14, 1.5, 3.8, false);   // unhit: the rocket goes off at the drum
            // backward difference: at f = 1 a forward step is zero-length
            pathPoint(e, 1, _pA);
            pathPoint(e, 0.99, _pB);
            _tan.copy(_pA).sub(_pB).normalize();
            e.group.quaternion.setFromUnitVectors(UP, _tan);
            e.group.position.copy(e.face).addScaledVector(_tan, -ARROW_TIP);   // the tip in the face
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
        // still stuck: the sim keeps a small fire going at the head
        // a bar is metal: a stuck arrow there gutters small (bars sit low and close to the eye)
        if (e.laneIdx >= 6) fireSim.smoulder(e.face, 8, fireDt, 0.45); else fireSim.smoulder(e.face, 30, fireDt, 0.8);
        // smoulder flicker + smoke puffs
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
      // orient along the path tangent: side-on, never a dot
      // backward difference, so a stuck arrow (clamped = 1) keeps its heading
      const f1 = Math.max(0, Math.min(clamped, 1) - 0.01);
      pathPoint(e, Math.max(clamped, 0.01), _pA);
      pathPoint(e, f1, _pB);
      _tan.copy(_pA).sub(_pB).normalize();
      e.group.quaternion.setFromUnitVectors(UP, _tan);
      // the path is the TIP's: it reaches the face on the beat and never goes past it
      pathPoint(e, clamped, _pB);
      e.group.position.copy(_pB).addScaledVector(_tan, -ARROW_TIP);
      // flame flicker
      // grow with distance so a far arrow is still a clear burning point,
      // not a speck that seems to fade out (screen size ~constant beyond 5 m)
      const far = Math.max(1, e.group.position.distanceTo(camera.position) / 5);
      // flame core keeps a readable size far away; the halo grows only a little,
      // so distant arrows are sharp points of fire, not blobs
      const s = 0.2 * Math.min(far, 5) * (0.9 + 0.2 * Math.random());   // the exhaust flame, in the lane's colour
      e.flame.scale.setScalar(s);
      e.glow.scale.setScalar(0.6 * Math.min(far, 1.8) * (0.9 + 0.2 * Math.random()));
      // the countdown it carries: 3, 2, 1 over its last three beats, the same size on screen at any distance
      const nLeft = dt > 0 ? Math.ceil(dt / beatDur) : 0, nShow = nLeft <= 3 ? nLeft : 0;
      if (nShow !== e.numN) { e.numN = nShow; if (nShow) e.num.material.map = COUNT_N[nShow]; }
      e.num.visible = nShow > 0;
      e.num.material.opacity = Math.min(1, dt / (0.5 * beatDur));   // the 1 fades out, gone at 0 (owner)
      if (nShow) { e.num.position.copy(e.group.position); e.num.position.y += 0.22 + 0.012 * e.group.position.distanceTo(camera.position); e.num.scale.setScalar(0.07 * Math.max(1.2, e.group.position.distanceTo(camera.position))); }
      // FIRE: the head pours flame into the simulation as it flies (world-space
      // head = group position + 0.3 m along the heading). Far arrows emit
      // bigger flames so they stay readable, like the core sprite.
      if (dt >= 0) {
        _pT.copy(e.group.position).addScaledVector(_tan, -0.07 * ROCKET_SCALE);   // the rocket's exhaust trails behind
        fireSim.trail(e.id, _pT, Math.min(far, 3) * 0.3);   // a small exhaust: the lane-coloured flame is the rocket (owner: less bloom)
      }
    }

    // MAGIC CHARGE (owner's design, replaces the shrinking ring): the drumhead
    // light fades in as the arrow comes, accelerating, and is BRIGHTEST —
    // whitening and flashing — exactly at the hit time, then drops in 0.12 s.
    // Hit at the peak = the magic at full strength = the arrow explodes.
    for (let lane = 0; lane < N_T; lane++) {
      let next = null;
      for (const e of activeNotes) {
        if (e.laneIdx !== lane || e.hit) continue;
        const dt = e.time - heardNow;
        if (dt < -(cuePulse ? 0.06 : 0.12) || dt > (cuePulse ? CUE_PULSE : 1.2)) continue;
        if (!next || Math.abs(dt) < Math.abs(next.dt)) next = { dt };
      }
      const r = rings[lane];
      const fl = firelights[lane];
      r.mesh.visible = false;
      // a gun column has ONE button: its bottom lane draws the glow for both rows; the top lane draws nothing
      const gunK = lane >= 6 ? (lane - 6) % BARS : -1;
      if (gunK >= PER_ROW) { if (fl) fl.glow.visible = false; continue; }
      if (gunK >= 0) { const topLane = lane + PER_ROW; pending[lane] = Math.max(pending[lane], pending[topLane]); previewAt[lane] = Math.max(previewAt[lane], previewAt[topLane]); }
      const frame = null;   // no square frames on the guns (owner, 2026-10-05): the halo alone, like the drums
      // the RED cue: the target itself warms to red as its arrow arrives, reddest on the beat
      const mat = drumMat[lane];
      if (mat && mat.color && !mat.userData.base) mat.userData.base = mat.color.clone();
      let tint = 0;
      if (pending[lane] > 0.01 && drumVisible[lane] && !cuePulse) {
        // the target glows up WITH its rocket / cart (owner, 2026-10-04): the game feeds its
        // progress down the lane — dim at launch, climbing, white-hot right on the beat — in the lane's colour
        const pl = pending[lane], ramp = pl * pl * pl;
        if (!laneCol[lane]) laneCol[lane] = hexToColor(laneHex(lane));
        const flash = Math.exp(-(heardNow - previewAt[lane]) / 0.1);   // the preview: full for an instant, gone in a quarter second
        fl.glow.visible = true;
        fl.glow.material.opacity = Math.min(1, (0.2 + 0.8 * pl * pl) * (0.65 + 0.35 * beatKick) + flash);
        fl.glow.scale.setScalar(fl.radius * (1.25 + 0.55 * ramp + 0.6 * flash));
        _mc.copy(laneCol[lane]).lerp(_white, Math.min(1, Math.max(0, (pl - 0.65) / 0.35) * 0.9 + 0.8 * flash));
        fl.glow.material.color.copy(_mc);
        if (frame) { frame.visible = true; frame.material.opacity = Math.min(1, 0.3 + 0.9 * pl); frame.material.color.copy(_mc); }
        if (mat && mat.userData.base) { mat.color.copy(mat.userData.base).lerp(_mc, 0.35 + 0.55 * ramp); }
        continue;
      }
      if (next && drumVisible[lane]) {
        const dt = next.dt;
        // charge 0..1: cubic so the brightening is fastest right before the beat
        const c = dt >= 0 ? Math.pow(1 - dt / (cuePulse ? CUE_PULSE : 1.2), 3) : Math.max(0, 1 + dt / (cuePulse ? 0.06 : 0.12));   // pulse mode: a short flash, dark before the next note
        const peak = Math.abs(dt) < 0.025 ? 1 : 0;              // the flash AT the beat
        fl.glow.visible = true;
        fl.glow.material.opacity = Math.min(1, 0.08 + 0.85 * c + 0.25 * peak);
        fl.glow.scale.setScalar(fl.radius * 2.6 * (0.75 + 0.45 * c + 0.3 * peak));
        _mc.copy(fl.base).lerp(_white, 0.55 * c * c + 0.3 * peak);   // white-hot at the peak
        fl.glow.material.color.copy(_mc);
        tint = Math.min(0.68, 0.58 * c + 0.15 * peak);
        if (frame) {
          frame.visible = true;
          frame.material.opacity = Math.min(1, 0.15 + 0.85 * c + 0.3 * peak);
          frame.material.color.copy(hexToColor(BAR_HEX[stationOf(lane)])).lerp(_white, 0.5 * c * c + 0.4 * peak);
        }
      } else {
        fl.glow.visible = false;
        fl.glow.material.opacity = 0;
        if (frame) frame.visible = false;
      }
      if (mat && mat.userData.base) mat.color.copy(mat.userData.base).lerp(_red, tint);
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

    braziers.update(fireDt, camera, performance.now());
    sea.update(performance.now() / 1000);
    hydra.update(fireDt, performance.now() / 1000, beatDur > 0 ? (heardNow - beatFirst) / beatDur : performance.now() / 1000);
    fireSim.update(fireDt);
    waterPool.update(performance.now() / 1000);
    fxCamera.position.copy(camera.position);
    fxCamera.quaternion.copy(camera.quaternion);
    fxCamera.projectionMatrix.copy(camera.projectionMatrix);
    fxCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    if (!fxSorted) sortFx();
    dynRes();
    if (PERF) {   // ?perf — milliseconds per pass (src/dev/perf.js), installed on the first frame, when every pass exists
      if (!perf) perf = installPerf({ renderer, bootlog, wrap: [["sun shadow", renderer.shadowMap, "render"]],
        passes: [...(composer ? composer.passes.map((p, i) => [(p === fxPass ? "fx" : p.constructor.name.replace("Pass", "")) + (p === shieldMix ? " mix" : ""), p]) : [["scene", renderer]]),
          ...(shieldGlow ? [["shield glow", shieldGlow], ...shieldGlow.passes.map((p, i) => ["  glow " + i + " " + p.constructor.name.replace("Pass", ""), p])] : [])] });
      perf.tick();
    }
    // the composer's passes don't render to a headset: draw straight to it
    if (vrOn() || !composer) renderer.render(scene, camera);
    else {
      lens.uniforms.time.value = performance.now() % 1000;
      if (shieldGlow && !glowShowing()) shieldMix.enabled = false;   // (10-09) nothing glowing in sight: no glow passes at all
      else if (shieldGlow) {   // the shield's own glow first, from the same view
        shieldMix.enabled = true;
        shieldCamera.position.copy(camera.position); shieldCamera.quaternion.copy(camera.quaternion);
        shieldCamera.projectionMatrix.copy(camera.projectionMatrix); shieldCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
        tagOccluders();
        for (const c of [shieldOccCamera]) { c.position.copy(camera.position); c.quaternion.copy(camera.quaternion); c.projectionMatrix.copy(camera.projectionMatrix); c.projectionMatrixInverse.copy(camera.projectionMatrixInverse); }
        shieldGlow.renderToScreen = shieldOnly;   // harness: show the channel alone
        // every OTHER frame (10-09 timer: its two scene walks cost ~3 ms CPU, more than the main picture): the glow is a soft
        // halo, the one from the frame before is kept between — no one can see a 16 ms-old blur
        if (shieldOnly || (glowFrame++ & 1) === 0) shieldGlow.render();
      }
      // the AO blacks out the SEA (found 2026-10-07: its own depth/normal pass doesn't see the sea's waves and
      // returns full occlusion there) — so it is off whenever the view faces the cove (+z): the sea station,
      // the gate behind you, flying out there. The three courts keep it.
      if (gtao) gtao.enabled = AO_ON && camera.getWorldDirection(_aoDir).z < 0.15 && camera.position.z < COVE.wallZ - 1;   // (10-08: also off anywhere IN the cove — looking sideways there blacked the sea too)
      if (!shieldOnly) composer.render();
    }
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
    mat.emissive.copy(hexToColor(laneHex(laneIdx)));
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
  gltfLoader().load("/models/Bdrum.glb", (gltf) => {
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
          mat.color.lerp(hexToColor(laneHex(i)), 0.22);
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
  }, undefined, (err) => { console.warn("drum model failed to load; keeping stand-ins", err); bootlog("drum model failed", { error: String(err && err.message || err), stack: String(err && err.stack || "").slice(0, 400) }); });

  bootlog("stage3d: end of build");
  return { resize, update, hit, press, strike, setDrumVisible, debugDrums,
    setLoop, addVrButton, hydra,
    /** DEV free camera: setFly(on), flyKey(key, down), flyLook(dx, dy) in pixels dragged; `fly` reads the state */
    setFly, get fly() { return fly.on; }, get editor() { return editor; },
    flyKey: (key, down) => { const kk = key.toLowerCase(); if (down) fly.keys.add(kk); else fly.keys.delete(kk); },
    flyLook: (dx, dy) => { fly.yaw -= dx * 0.0024; fly.pitch = Math.max(-1.5, Math.min(1.5, fly.pitch - dy * 0.0024)); },   // pixels moved (pointer-locked)
    flySpeed: (k) => { fly.speed = Math.max(0.5, Math.min(40, fly.speed * k)); return fly.speed; },
    flyPose: (x, y, z, yaw, pitch) => { fly.pos.set(x, y, z); fly.yaw = yaw; fly.pitch = pitch; },   // dev: put the free camera somewhere exact (photos)
    /** turn to a station: "drums" | "bass" | "treble" */
    setStation(name) {
      if (!STATIONS[name]) return;
      if (name === "sea") usePlaySpot();   // round 4 stands on his altar, wherever it is now
      station = name;
      applyZone();   // (10-11: this ran BEFORE the station changed, so the cove stayed hidden through the whole fly-in — his bug report)
      if (!MOBILE && !LOW) lantern.castShadow = name === "drums";   // the lantern lights the drums only: its shadows are wasted elsewhere
      restDir.copy(REST_DIR).applyAxisAngle(UP, STATIONS[name].yaw);
      hands.forEach((hand, h) => {
        hand.rest.copy(HAND_RESTS[name][h]);
        if (!hand.active && !vrOn()) { hand.group.position.copy(hand.rest); hand.group.quaternion.setFromUnitVectors(UP, restDir); }
      });
    }, get scene() { return scene; }, get camera() { return camera; }, flyIn: (s, f) => flyIn(s, f), get flying() { return !!cine; },
    /** THE BIG TO-DO (10-09): the sea gate (his "gate-sea") lifts out of the way over `seconds` */
    openSeaGate(seconds = 2.5) {
      let g = null; scene.traverse((o) => { if (o.userData && o.userData.editId === "gate-sea") g = o; });
      if (!g) return; const y0 = g.position.y, t0 = performance.now();
      const step = () => { const u = Math.min(1, (performance.now() - t0) / (seconds * 1000)); g.position.y = y0 + 6.5 * u * u * (3 - 2 * u); if (u < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }, boothPos: BOOTH_POS, playSpot: () => playSpot(), lighting, get station() { return station; }, melodyStations, kit: KIT, pickDrum, drumScreen, get mobile() { return MOBILE; }, get tier() { return TIER; }, debugTextures: () => { const s = []; scene.traverse((o) => { for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) for (const k in m) if (m[k] && m[k].isTexture && m[k].image && m[k].image.width) s.push(m[k].image.width); }); return Math.max(0, ...s); },
    /** look input, each -1..1: x = right, y = up (screen mode only) */
    setLookInput: (x, y) => { look.inX = Math.max(-1, Math.min(1, x)); look.inY = Math.max(-1, Math.min(1, y)); }, setVrHitHandler: (fn) => { onVrHit = fn; },
    /** debug: where each stick tip is (world), and whether a controller holds it */
    /** debug: arrows in flight per lane, and which drums are shown */
    // per lane: how much of an arrow's flight the camera sees right now (0..1), and whether its launch is on screen
    /** the shield's three parts: { drums|bass|treble: { progress 0..1, up } } */
    setShield: (state) => defense.setShield(state),
    volley: (a) => defense.volley(a),
    /** the guns' timing cues: [{laneIdx, time}] — fuses on cannons, falling shells into mortars */
    setGunCues: (cues) => { gunCues = cues; },
    setCrystalState: (st) => { crystalState = st; },
    debugGunCues: (cues) => { gunCuesTest = cues; },
    debugCountdown: () => [0, 1, 2, 3, 4, 5].map((i) => Math.max(0, ...activeNotes.filter((e) => e.laneIdx === i && e.num.visible).map((e) => e.numN))),
    debugGunInfo: () => ({ red: melodyStations.bass.bars.map((b) => +(b._red || 0).toFixed(2)) }),
    debugShieldGlowAmount: (v) => { if (shieldMix) shieldMix.uniforms.amount.value = v; },   // harness
    setCuePulse: (on) => { cuePulse = !!on; },   // full-song mode: short per-note flashes instead of the long warm-up
    get fireTexture() { return fireTexture; }, get fireSim() { return fireSim; },   // lent to round 4's kit: the same comets and trails as the rockets
    debugShieldOnly: (on) => { shieldOnly = !!on; },
    get debugBatcher() { return batcher; },
    debugGlowers: () => { const on = glowShowing(); return [on, ...(glowers || []).filter((o) => shown(o) && (!o.frustumCulled || !o.geometry || _gFr.intersectsObject(o))).map((o) => (o.parent && o.parent.name ? o.parent.name + "/" : "") + (o.name || o.type) + "@" + o.getWorldPosition(new THREE.Vector3()).toArray().map((v) => v.toFixed(1)).join(","))]; },   // harness: what keeps the glow pass on
    debugShieldInfo: () => {
      const meshes = []; scene.traverse((o) => { if (o.isMesh && o.material && o.material.uniforms && o.material.uniforms.uTexB) meshes.push({ mask: o.layers.mask, vis: o.visible, strength: +o.material.uniforms.uStrength.value.toFixed(2) }); });
      return { meshes, camMask: shieldCamera && shieldCamera.layers.mask, camPos: shieldCamera && shieldCamera.position.toArray().map((v) => +v.toFixed(2)), mainPos: camera.position.toArray().map((v) => +v.toFixed(2)) };
    },
    /** harness: the shield-glow image's average + peak brightness (is the channel producing anything?) */
    debugShieldGlow: () => {
      if (!shieldGlow) return null;
      const rt = shieldGlow.readBuffer, w = rt.width, h = rt.height, n = 64, px = new Float32Array(4);
      let sum = 0, peak = 0, buf = rt.texture.type === THREE.UnsignedByteType ? new Uint8Array(4) : new Float32Array(4);
      for (let i = 0; i < n; i++) { renderer.readRenderTargetPixels(rt, Math.floor((i % 8 + 0.5) / 8 * w), Math.floor((Math.floor(i / 8) + 0.5) / 8 * h), 1, 1, buf); const l = (buf[0] + buf[1] + buf[2]) / 3; sum += l; peak = Math.max(peak, l); }
      return { type: rt.texture.type, avg: +(sum / n).toFixed(4), peak: +peak.toFixed(4), passes: shieldGlow.passes.length };
    },
    /** per target 0..1: how strongly it glows as "coming up next" */
    /** the song's beat grid: cues count in on it */
    setBeat: (first, dur) => { beatFirst = first; beatDur = dur; },
    cueSpan,
    setPending: (levels) => { pending.fill(0); for (const [i, v] of Object.entries(levels)) pending[+i] = Math.max(pending[+i], v); },
    debugDefense: (heard) => ({ heard: +heard.toFixed(2), ...defense.debug() }),
    /** a missed arrow reached the shield: flash the part in front of that target */
    /** a top-row note fires that bar's cannon at its archer, at heard time `at` */
    /** a gun's shell flight (s): mortars lob slow, cannons fly fast */
    gunFlight: (laneIdx) => { const name = laneIdx < 6 + BARS ? "bass" : "treble", b = melodyStations[name] && melodyStations[name].bars[(laneIdx - 6) % BARS]; return b && b.mortar ? 1.5 : 0.9; },
    /** a crystal struck: it flares and arcs into the orb */
    crystalHit: (laneIdx) => { const k = (laneIdx - 6) % BARS, b = melodyStations.treble.bars[k]; if (!b || !b.crystal) return; crystalPulse[k] = 1;
      const a = arcs.reduce((best, x) => (x.t0 < best.t0 ? x : best)); a.t0 = lgState.now; a.from.copy(b.muzzle); },
    /** no key letters on the drums (touch screens: there are no keys) */
    hideDrumLabels: () => { labelsOff = true; for (const l of drumLabels) l.visible = false; },
    /** what the drums say: an array by lane (a controller's buttons), or null for the keyboard letters (owner, 2026-10-06: "the drums need the controls on them like the others") */
    setDrumLabels: (texts) => { drumLabelMats.forEach((m, i) => { const t = texts ? texts[i] : drumKeys[i]; if (!t || m.userData.text === t) return; m.map.dispose(); m.map = labelTex(t); m.userData.text = t; m.needsUpdate = true; }); },
    showDrumLabels: () => { labelsOff = false; drumLabels.forEach((l, i) => { l.visible = drumVisible[i]; }); },
    setCharge: (f) => { lgState.charge = Math.max(0, Math.min(1, f)); },
    lightningStrike: (target) => { lgState.boltT0 = lgState.now; lgState.from.copy(LG.pos); lgState.to.copy(target); },
    /** a BALLOON's rocket (siege.js "balloonRocket"): from the balloon down at the cannon row, bursting there, landing at `landAt` */
    enemyRocket: (e, landAt, heardNow) => { const c = COURTS[e.side], from = new THREE.Vector3(0, 0, 0.3).addScaledVector(c.fwd, e.dist).addScaledVector(c.right, e.lat).setY((e.alt || 7) - 1.2);
      const row = melodyStations[e.side].bars, tgt = row[PER_ROW + Math.floor(Math.random() * PER_ROW)];
      const to = tgt.muzzle.clone(); to.y = Math.max(0.3, to.y - 0.6);
      defense.fire(from, to, heardNow, { arc: 0.4, dur: Math.max(0.3, landAt - heardNow) }); },
    /** a point down a side's court (dist m out, lat m across, y up) — where an enemy stands */
    enemyPos: (side, dist, lat, y = 0) => { const c = COURTS[side]; return new THREE.Vector3(0, 0, 0.3).addScaledVector(c.fwd, dist).addScaledVector(c.right, lat).setY(y); },
    troopSpawn: (e) => troops.spawn(e), troopKill: (e, by) => troops.kill(e, by), bossHit: (e) => troops.bossHit(e),
    debugTroops: () => troops.debug(),
    fireCannon: (laneIdx, at, target = null) => {
      if (laneIdx < 6 || laneIdx >= N_T) return;
      const name = laneIdx < 6 + BARS ? "bass" : "treble", k = (laneIdx - 6) % BARS;
      const b = melodyStations[name].bars[k], from = b.muzzle || drumFace[laneIdx];
      firing.push({ at, laneIdx });   // the tell, when the shot leaves
      if (target) {   // at an enemy (siege.js aimed it): {dist, lat} down this court
        const c = COURTS[name];
        _shot.set(0, 0, 0.3).addScaledVector(c.fwd, target.dist).addScaledVector(c.right, target.lat);
        _shot.y = target.alt || (b.mortar ? 0.3 : 1.0);   // a balloon: up where it floats
        defense.fire(from, _shot, at, b.mortar ? { arc: 9, dur: 1.5 } : { arc: 1.2, dur: 0.9 });
        return;
      }
      // FORWARD, down the court you're facing (owner: "so we can see"), fanned across the view
      const yaw = STATIONS[name].yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), j = (k % PER_ROW) - (PER_ROW - 1) / 2;
      if (b.mortar) {   // mortars lob high, landing nearer down the court
        _shot.set(from.x + fx * 18 + -fz * j * 1.4, 0.3, from.z + fz * 18 + fx * j * 1.4);
        defense.fire(from, _shot, at, { arc: 11, dur: 1.5 });
      } else {
        _shot.set(from.x + fx * 26 + -fz * j * 1.6, 9, from.z + fz * 26 + fx * j * 1.6);
        defense.fire(from, _shot, at);
      }
    },
    debugArrowView: () => {
      camera.updateMatrixWorld();
      const P = new THREE.Vector3(), out = [];
      for (let i = 0; i < N_T; i++) {
        let seen = 0, launch = false;
        for (let k = 0; k <= 20; k++) {
          const f = k / 20;
          P.copy(SPAWNS[i]).lerp(drumFace[i], f); P.y += ARC_LIFT[i] * 4 * f * (1 - f);
          P.project(camera);
          const vis = P.z < 1 && Math.abs(P.x) <= 1 && Math.abs(P.y) <= 1;
          if (vis) seen++;
          if (k === 0) launch = vis;
        }
        out.push([+(seen / 21).toFixed(2), launch]);
      }
      return out;
    },
    debugArrows: () => ({ flying: Array.from({ length: N_T }, (_, i) => i).map((i) => activeNotes.filter((e) => e.laneIdx === i).length), shown: [...drumVisible] }),
    /** debug: which ghost hands are showing right now (lane order) */
    debugGhosts: () => ghostHands.map((g) => g.group.visible),
    debugPasses: { bloom, lens, smaa, gtao, fxPass, renderer, scene, fireLights },
    debugRipple: (x, z, s = 1) => waterPool.addRipple(x, z, s),   // harness: a splash in the pool
    debugClouds: (rot) => { if (rot != null) cloudRot = rot; return { rot: +cloudRot.toFixed(3), overSun: +cloudOverSun().toFixed(2), sunlit: +sunlit.toFixed(2) }; },   // harness: toggle .enabled to compare
    debugVr: () => hands.map((h, i) => { h.group.updateWorldMatrix(true, false); const p = h.group.localToWorld(new THREE.Vector3(0, STICK_LEN, 0));
      return { hand: i, held: !!h.grip, gripVisible: h.grip ? h.grip.visible : null, tip: [p.x, p.y, p.z].map((v) => +v.toFixed(3)) }; }), get vr() { return vrOn(); } };
}
