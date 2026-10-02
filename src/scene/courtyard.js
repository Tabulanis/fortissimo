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
     far building     wall at z = -46, 11 m tall, open arch in the middle */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const ARCHER_ROOF_Y = 7.6;      // top of the colonnade roofs
export const ARCHER_ROOF_X = 6.3;      // inner roof edge, each side
export const ARCHER_ROOF_Z = [-42, -8]; // the stretch of roof archers use
const FAR_H = 8;   // far building height (was 11: it hid the sunset — owner 2026-10-02)
export const FAR_WALL = { z: -46.5, top: FAR_H + 0.6, halfWidth: 9 };

const SAND = 0xc9a77c, SAND_DARK = 0x8f6f4f, TERRACOTTA = 0xb5643c, LEAF = 0x3f5a2e, WOOD = 0x6b4a32;

/** soften a tiling canvas: blur a 3x3 tiled copy, keep the middle (seams stay seamless) */
function blurTiled(c, px) {
  const W = c.width, H = c.height;
  const big = document.createElement("canvas"); big.width = W * 3; big.height = H * 3;
  const bg = big.getContext("2d");
  bg.filter = `blur(${px}px)`;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) bg.drawImage(c, i * W, j * H);
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  out.getContext("2d").drawImage(big, W, H, W, H, 0, 0, W, H);
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

function flagstoneTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");
  // matching height + roughness canvases: grout sits low and rough, stone faces
  // are slightly domed and worn smoother in places (catches the fire's glints)
  const hc = document.createElement("canvas"); hc.width = hc.height = 1024;
  const hg = hc.getContext("2d");
  hg.fillStyle = "#000"; hg.fillRect(0, 0, 1024, 1024);
  const rc = document.createElement("canvas"); rc.width = rc.height = 1024;
  const rg = rc.getContext("2d");
  rg.fillStyle = "#fff"; rg.fillRect(0, 0, 1024, 1024);
  g.fillStyle = "#5c4a38";                       // grout
  g.fillRect(0, 0, 1024, 1024);
  // rows of irregular flagstones in warm sandstone tones
  let y = 0;
  while (y < 1024) {
    const h = 70 + Math.random() * 90;
    let x = -Math.random() * 120;
    while (x < 1024) {
      const w = 90 + Math.random() * 170;
      const tone = 150 + Math.random() * 60;
      g.fillStyle = `rgb(${tone + 40},${tone + 12},${tone - 30})`;
      g.fillRect(x + 4, y + 4, w - 8, h - 8);
      // height: bevelled edge rising to a slightly uneven face
      const lift = 150 + Math.random() * 70;
      for (let b = 0; b < 6; b++) {
        const v = Math.round(lift * (b + 1) / 6);
        hg.fillStyle = `rgb(${v},${v},${v})`;
        hg.fillRect(x + 4 + b, y + 4 + b, w - 8 - 2 * b, h - 8 - 2 * b);
      }
      // roughness: each stone its own wear, polished patches where feet go
      const rough = 200 + Math.random() * 55;   // 0.78..1: worn sandstone, never glossy
      rg.fillStyle = `rgb(${rough},${rough},${rough})`;
      rg.fillRect(x + 4, y + 4, w - 8, h - 8);
      for (let k = 0; k < 3; k++) {
        const px = x + Math.random() * w, py = y + Math.random() * h, pr = 15 + Math.random() * 40;
        rg.fillStyle = "rgba(120,120,120,0.18)";
        rg.beginPath(); rg.arc(px, py, pr, 0, Math.PI * 2); rg.fill();
        hg.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";   // gentle dips and rises
        hg.beginPath(); hg.arc(px, py, pr, 0, Math.PI * 2); hg.fill();
      }
      // a little mottling so it isn't flat
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(${60 + Math.random() * 60},${40 + Math.random() * 40},20,0.08)`;
        g.beginPath();
        g.arc(x + Math.random() * w, y + Math.random() * h, 10 + Math.random() * 30, 0, Math.PI * 2);
        g.fill();
      }
      x += w;
    }
    y += h;
  }
  return { map: canvasTex(c, true), normalMap: canvasTex(heightToNormal(blurTiled(hc, 3), 2.2)), roughnessMap: canvasTex(blurTiled(rc, 2)) };
}

export function createCourtyard(scene) {
  const root = new THREE.Group();
  root.name = "courtyard";
  scene.add(root);
  const grain = stoneGrainMaps();
  for (const t of [grain.normalMap, grain.roughnessMap]) t.repeat.set(2, 2);
  const stone = new THREE.MeshStandardMaterial({ color: SAND, roughness: 0.95, normalMap: grain.normalMap, roughnessMap: grain.roughnessMap });
  const stoneDark = new THREE.MeshStandardMaterial({ color: SAND_DARK, roughness: 1, normalMap: grain.normalMap, roughnessMap: grain.roughnessMap });
  const shadowy = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1 });
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
    return m;
  };

  // --- paved floor
  const flags = flagstoneTexture();
  for (const t of [flags.map, flags.normalMap, flags.roughnessMap]) t.repeat.set(4, 13);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 52),
    new THREE.MeshStandardMaterial({ map: flags.map, normalMap: flags.normalMap, roughnessMap: flags.roughnessMap,
      roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 0.45 }));   // stone reflects little sky
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.005, -20);
  floor.receiveShadow = true;
  root.add(floor);

  // (the floor medallion made way for the reflecting pool: see pool.js)
  root.userData.flagsMap = flags.map;   // the pool's bottom is the same paving

  // --- colonnades: stylobate, entablature, roof, back wall with dark doorways
  for (const side of [-1, 1]) {
    box(3.2, 0.4, 50, stoneDark, side * 7.4, 0.2, -20);              // raised walkway
    box(2.6, 1.0, 50, stone, side * 7.2, 6.9, -20);                   // beam over the columns
    box(4.2, 0.35, 50.4, stoneDark, side * 7.9, 7.55, -20);           // roof slab (archers' ledge)
    box(0.8, 7.6, 50, stone, side * 9.6, 3.8, -20);                   // portico back wall
    for (let z = 0; z > -44; z -= 6.4) {                               // arched doorways (dark insets)
      box(0.1, 3.2, 1.8, shadowy, side * 9.15, 2.0, z - 3.2);
      const arch = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24, 0, Math.PI), shadowy);
      arch.rotation.y = -side * Math.PI / 2;
      arch.position.set(side * 9.15, 3.6, z - 3.2);
      root.add(arch);
    }
  }

  // --- far building: wall with an OPEN archway, cornice, rooftop finials
  const F = FAR_WALL;
  box(7.0, FAR_H, 1.2, stone, -5.5, FAR_H / 2, F.z);
  box(7.0, FAR_H, 1.2, stone, 5.5, FAR_H / 2, F.z);
  box(4.0, FAR_H - 6.4, 1.2, stone, 0, (FAR_H + 6.4) / 2, F.z);     // over the arch
  const archTop = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 1.2, 32, 1, false, 0, Math.PI), stone);
  archTop.rotation.z = Math.PI / 2; archTop.rotation.y = Math.PI / 2;
  archTop.position.set(0, 6.4, F.z);
  root.add(archTop);
  box(19.6, 0.6, 1.8, stoneDark, 0, FAR_H + 0.3, F.z);                // cornice
  for (const x of [-8.5, -3.5, 3.5, 8.5]) box(0.7, 1.0, 0.7, stoneDark, x, FAR_H + 1.1, F.z);
  box(20, FAR_H, 0.6, stoneDark, 0, FAR_H / 2, F.z - 9);              // the next wall beyond the arch

  // --- terracotta pots with plants along the walkway edges, benches between
  const potMat = new THREE.MeshStandardMaterial({ color: TERRACOTTA, roughness: 0.8 });
  const leafMat = new THREE.MeshStandardMaterial({ color: LEAF, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.85 });
  const potGeo = new THREE.CylinderGeometry(0.45, 0.3, 0.7, 20);
  const leafGeo = new THREE.IcosahedronGeometry(0.55, 1);
  for (const side of [-1, 1]) {
    for (let z = -4; z > -42; z -= 6.4) {
      const pot = new THREE.Mesh(potGeo, potMat);
      pot.position.set(side * 5.6, 0.75, z);
      pot.castShadow = true; pot.receiveShadow = true;
      root.add(pot);
      for (let k = 0; k < 3; k++) {
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.set(side * 5.6 + (Math.random() - 0.5) * 0.4, 1.4 + k * 0.35, z + (Math.random() - 0.5) * 0.4);
        leaf.scale.setScalar(0.9 - k * 0.2);
        leaf.castShadow = true;
        root.add(leaf);
      }
      box(0.5, 0.45, 1.8, woodMat, side * 6.4, 0.62, z - 3.2);       // bench
    }
  }

  // --- columns: the owner's Pillar.glb, scaled to 6.3 m, both sides
  new GLTFLoader().load("/models/Pillar.glb", (gltf) => {
    const src = gltf.scene;
    src.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(src);
    const size = b.getSize(new THREE.Vector3());
    const k = 6.3 / size.y;
    // the pillar texture is a cool grey marble; tint it toward the reference's
    // warm sandstone (one shared material — delete these lines for the raw asset)
    let warm = null;
    src.traverse((o) => { if (o.isMesh && !warm) { warm = o.material.clone(); warm.color.set(0xf2c18a); } });
    for (const side of [-1, 1]) {
      for (let z = 1; z >= -42; z -= 3.2) {
        const col = src.clone(true);
        col.scale.multiplyScalar(k);
        // base on the walkway (y 0.4), centred on its spot
        col.position.set(
          side * 6.8 - (b.min.x + b.max.x) / 2 * k,
          0.4 - b.min.y * k,
          z - (b.min.z + b.max.z) / 2 * k,
        );
        col.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material = warm; } });
        root.add(col);
      }
    }
  }, undefined, (err) => console.warn("Pillar.glb failed to load", err));

  return root;
}
