/* courtyard.js — the mock-up environment (owner's reference: a sandstone
   Roman-style courtyard, colonnades down both sides, paved floor, terracotta
   pots — with an OPEN archway at the far end instead of a big gate).

   Everything here is placeholder geometry EXCEPT the columns, which use the
   owner's Pillar.glb. Swap pieces freely: nothing in the game logic depends
   on this file except the rooftop lines the archers fire from (ARCHER_*).

   Layout (metres, player seated near z = +2 looking toward -z):
     floor            x -8..8, z +6..-46
     colonnades       columns at x = ±6.8, every 3.2 m from z = +1 to -42
     colonnade roofs  y = 7.4  (archers stand on the inner edge, x = ±6.3)
     far building     wall at z = -46, 5.6 m tall, open arch in the middle */
import * as THREE from "three";
import { bootlog } from "../bootlog.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const ARCHER_ROOF_Y = 7.6;      // top of the colonnade roofs
export const ARCHER_ROOF_X = 6.3;      // inner roof edge, each side
export const ARCHER_ROOF_Z = [-42, -8]; // the stretch of roof archers use
const FAR_H = 5.6;   // far building height (11 hid the sunset — owner 2026-10-02; 8 still loomed — owner 2026-10-03)
const ARCH_Y = FAR_H - 1.6;   // where the arch's curve starts (the opening is about this tall)
export const FAR_WALL = { z: -46.5, top: FAR_H + 0.6, halfWidth: 9 };

const SAND = 0xc9a77c, SAND_DARK = 0x8f6f4f, TERRACOTTA = 0xb5643c, LEAF = 0x3f5a2e, WOOD = 0x6b4a32;

/** soften a tiling canvas: blur it inside a thin wrapped border, keep the middle
 *  (seams stay seamless). Only a 4-blur-radius margin is added: a full 3x3 copy
 *  was a 3072-px canvas per blur and crashed a budget tablet's GPU (2026-10-02). */
function blurTiled(c, px) {
  const W = c.width, H = c.height, m = Math.ceil(px * 4);
  const pad = document.createElement("canvas"); pad.width = W + 2 * m; pad.height = H + 2 * m;
  const pg = pad.getContext("2d");
  pg.filter = `blur(${px}px)`;
  // the tile plus its wrapped-around neighbours, offset so only the margin shows them
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) pg.drawImage(c, m + i * W, m + j * H);
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  out.getContext("2d").drawImage(pad, m, m, W, H, 0, 0, W, H);
  return out;
}

/** height canvas (white = high) -> tangent-space normal map canvas (Sobel) */
function heightToNormal(hc, strength) {
  const W = hc.width, H = hc.height;
  const src = hc.getContext("2d").getImageData(0, 0, W, H).data;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const og = out.getContext("2d");
  const img = og.createImageData(W, H);
  const h = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;   // wraps: tiles seamlessly
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * W + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}
function canvasTex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** stone grain for walls and columns: soft blotches + fine pits, tiling */
function stoneGrainMaps() {
  const N = 512;
  const hc = document.createElement("canvas"); hc.width = hc.height = N;
  const hg = hc.getContext("2d");
  const rc = document.createElement("canvas"); rc.width = rc.height = N;
  const rg = rc.getContext("2d");
  hg.fillStyle = "#808080"; hg.fillRect(0, 0, N, N);
  rg.fillStyle = "#d8d8d8"; rg.fillRect(0, 0, N, N);
  const blot = (g, x, y, r, col) => { for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { g.fillStyle = col; g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill(); } };
  for (let k = 0; k < 900; k++) {
    const x = Math.random() * N, y = Math.random() * N, r = 2 + Math.random() * 22;
    const v = Math.random();
    blot(hg, x, y, r, `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},0.05)`);
    blot(rg, x, y, r, `rgba(${v > 0.5 ? 255 : 120},${v > 0.5 ? 255 : 120},${v > 0.5 ? 255 : 120},0.06)`);
  }
  for (let k = 0; k < 2500; k++) blot(hg, Math.random() * N, Math.random() * N, 0.6 + Math.random() * 1.4, "rgba(0,0,0,0.35)");   // pits
  return { normalMap: canvasTex(heightToNormal(blurTiled(hc, 1.5), 2.6)), roughnessMap: canvasTex(blurTiled(rc, 2)) };
}

/* THE CROSSROADS (2026-10-02): three stations around the player — drums ahead,
 * bass to the right, treble to the left — so the arena is a plaza where three
 * colonnaded courts meet, with a closing wall and gate behind.
 *   plaza    x -8..8, z -8..8 (the player near the middle)
 *   ARMS     each court in its own frame: lateral x' -8..8, running away from
 *            the plaza along -z'; turned by `yaw` and placed at `origin` */
export const ARMS = {
  drums:  { origin: [0, 0, -8], yaw: 0, length: 38 },            // ahead: pool, far wall, sunset
  bass:   { origin: [8, 0, 0], yaw: -Math.PI / 2, length: 26 },  // to the right: the night sky
  treble: { origin: [-8, 0, 0], yaw: Math.PI / 2, length: 26 },  // to the left
};
/** a point in an arm's own frame -> world */
export function armToWorld(arm, x, y, z, out = new THREE.Vector3()) {
  const a = ARMS[arm], c = Math.cos(a.yaw), s = Math.sin(a.yaw);
  return out.set(a.origin[0] + x * c + z * s, y, a.origin[2] - x * s + z * c);
}
/** a random archer's spot on an arm's rooftops (inner roof edges, or the end wall's top) */
export function archerSpot(arm, rand = Math.random, out = new THREE.Vector3()) {
  const L = ARMS[arm].length;
  if (rand() < 0.3) return armToWorld(arm, (rand() * 2 - 1) * FAR_WALL.halfWidth, FAR_WALL.top, -L - 0.5, out);
  const side = rand() < 0.5 ? -1 : 1;
  return armToWorld(arm, side * (ARCHER_ROOF_X + rand() * 1.5), ARCHER_ROOF_Y, -2 - rand() * (L - 6), out);
}

export function createCourtyard(scene) {
  const root = new THREE.Group();
  root.name = "courtyard";
  scene.add(root);
  bootlog("courtyard: stone grain");
  const grain = stoneGrainMaps();
  for (const t of [grain.normalMap, grain.roughnessMap]) t.repeat.set(2, 2);
  const stone = new THREE.MeshStandardMaterial({ color: SAND, roughness: 0.95, normalMap: grain.normalMap, roughnessMap: grain.roughnessMap });
  const stoneDark = new THREE.MeshStandardMaterial({ color: SAND_DARK, roughness: 1, normalMap: grain.normalMap, roughnessMap: grain.roughnessMap });
  const shadowy = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1 });
  const boxIn = (parent) => (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const box = boxIn(root);

  // --- paving: the owner's cobblestone set (diffuse / roughness / normal),
  // public/textures/stone_*; one texture set shared by every floor piece
  bootlog("courtyard: floor textures");
  const STONE_TILE = 2.5;   // metres per repeat: cobbles come out a real size
  const loader = new THREE.TextureLoader();
  const stoneTex = (file, srgb) => {
    const t = loader.load("/textures/" + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const flags = { map: stoneTex("stone_diff.jpg", true), normalMap: stoneTex("stone_norm.webp"), roughnessMap: stoneTex("stone_rough.jpg") };
  bootlog("courtyard: floor textures done");
  // ONE material + texture set for every piece; each piece scales its own UVs
  // to tile every 4 m (copies of the textures per piece cost a weak GPU dearly)
  const floorMat = new THREE.MeshStandardMaterial({ map: flags.map, normalMap: flags.normalMap, roughnessMap: flags.roughnessMap,
    roughness: 1, normalScale: new THREE.Vector2(1, 1), envMapIntensity: 0.45 });   // stone reflects little sky
  const floorPiece = (w, d, x, z, parent = root) => {
    const geo = new THREE.PlaneGeometry(w, d);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / STONE_TILE, uv.getY(i) * d / STONE_TILE);
    const m = new THREE.Mesh(geo, floorMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.005, z);
    m.receiveShadow = true;
    parent.add(m);
  };
  floorPiece(16, 16, 0, 0);                       // the plaza
  root.userData.flagsMap = flags.map;             // the pool's bottom is the same paving

  const potMat = new THREE.MeshStandardMaterial({ color: TERRACOTTA, roughness: 0.8 });
  const leafMat = new THREE.MeshStandardMaterial({ color: LEAF, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.85 });
  const potGeo = new THREE.CylinderGeometry(0.45, 0.3, 0.7, 20);
  const leafGeo = new THREE.IcosahedronGeometry(0.55, 1);
  const pillarSpots = [];   // [group, x', z'] for the Pillar.glb columns, filled per arm

  // --- one COURT: colonnades both sides, pots and benches, an arched end wall
  for (const [name, A] of Object.entries(ARMS)) {
    const g = new THREE.Group();
    g.name = "arm-" + name;
    g.position.set(...A.origin);
    g.rotation.y = A.yaw;
    root.add(g);
    const b = boxIn(g), L = A.length;
    floorPiece(16, L, 0, -L / 2, g);
    for (const side of [-1, 1]) {
      b(3.2, 0.4, L, stoneDark, side * 7.4, 0.2, -L / 2);            // raised walkway
      b(2.6, 1.0, L, stone, side * 7.2, 6.9, -L / 2);                 // beam over the columns
      b(4.2, 0.35, L + 0.4, stoneDark, side * 7.9, 7.55, -L / 2);     // roof slab (archers' ledge)
      b(0.8, 7.6, L, stone, side * 9.6, 3.8, -L / 2);                 // portico back wall
      for (let z = -3.2; z > -L + 2; z -= 6.4) {                       // arched doorways (dark insets)
        b(0.1, 3.2, 1.8, shadowy, side * 9.15, 2.0, z);
        const arch = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24, 0, Math.PI), shadowy);
        arch.rotation.y = -side * Math.PI / 2;
        arch.position.set(side * 9.15, 3.6, z);
        g.add(arch);
      }
      for (let z = -4; z > -L + 4; z -= 6.4) {                         // pots with plants, benches between
        const pot = new THREE.Mesh(potGeo, potMat);
        pot.position.set(side * 5.6, 0.75, z);
        pot.castShadow = true; pot.receiveShadow = true;
        g.add(pot);
        for (let k = 0; k < 3; k++) {
          const leaf = new THREE.Mesh(leafGeo, leafMat);
          leaf.position.set(side * 5.6 + (Math.random() - 0.5) * 0.4, 1.4 + k * 0.35, z + (Math.random() - 0.5) * 0.4);
          leaf.scale.setScalar(0.9 - k * 0.2);
          leaf.castShadow = true;
          g.add(leaf);
        }
        b(0.5, 0.45, 1.8, woodMat, side * 6.4, 0.62, z - 3.2);
      }
      for (let z = -1.6; z > -L + 1; z -= 3.2) pillarSpots.push([g, side * 6.8, z]);
    }
    // the end building: wall with an OPEN archway, cornice, rooftop finials, a wall beyond
    const ez = -L - 0.5;
    b(7.0, FAR_H, 1.2, stone, -5.5, FAR_H / 2, ez);
    b(7.0, FAR_H, 1.2, stone, 5.5, FAR_H / 2, ez);
    b(4.0, FAR_H - ARCH_Y, 1.2, stone, 0, (FAR_H + ARCH_Y) / 2, ez);   // over the arch
    const archTop = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 1.2, 32, 1, false, 0, Math.PI), stone);
    archTop.rotation.z = Math.PI / 2; archTop.rotation.y = Math.PI / 2;
    archTop.position.set(0, ARCH_Y, ez);
    g.add(archTop);
    b(19.6, 0.6, 1.8, stoneDark, 0, FAR_H + 0.3, ez);                // cornice
    for (const x of [-8.5, -3.5, 3.5, 8.5]) b(0.7, 1.0, 0.7, stoneDark, x, FAR_H + 1.1, ez);
    b(20, FAR_H, 0.6, stoneDark, 0, FAR_H / 2, ez - 9);              // the next wall beyond the arch
  }

  // --- behind the player: a closing wall with a (shut) gate, cornice
  box(19.2, 7.6, 1.0, stone, 0, 3.8, 8.6);
  box(3.2, 4.4, 0.1, shadowy, 0, 2.2, 8.05);                           // the gate
  const gateArch = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24, 0, Math.PI), shadowy);
  gateArch.rotation.y = Math.PI;
  gateArch.position.set(0, 4.4, 8.05);
  root.add(gateArch);
  box(19.6, 0.5, 1.6, stoneDark, 0, 7.85, 8.6);
  // --- corner piers where the courts meet (close the gaps between their walls)
  for (const x of [-8.8, 8.8]) for (const z of [-8.8, 8.8]) box(2.4, 8.2, 2.4, stone, x, 4.1, z);

  bootlog("courtyard: geometry done");
  // --- columns: the owner's Pillar.glb, scaled to 6.3 m, every court
  new GLTFLoader().load("/models/Pillar.glb", (gltf) => {
    const src = gltf.scene;
    src.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(src);
    const size = bb.getSize(new THREE.Vector3());
    const k = 6.3 / size.y;
    // the pillar texture is a cool grey marble; tint it toward the reference's
    // warm sandstone (one shared material — delete these lines for the raw asset)
    let warm = null;
    src.traverse((o) => { if (o.isMesh && !warm) { warm = o.material.clone(); warm.color.set(0xf2c18a); } });
    for (const [g, x, z] of pillarSpots) {
      const col = src.clone(true);
      col.scale.multiplyScalar(k);
      col.position.set(x - (bb.min.x + bb.max.x) / 2 * k, 0.4 - bb.min.y * k, z - (bb.min.z + bb.max.z) / 2 * k);
      col.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material = warm; } });
      g.add(col);
    }
  }, undefined, (err) => console.warn("Pillar.glb failed to load", err));

  return root;
}
