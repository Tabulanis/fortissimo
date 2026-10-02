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
export const FAR_WALL = { z: -46.5, top: 11.6, halfWidth: 9 };

const SAND = 0xc9a77c, SAND_DARK = 0x8f6f4f, TERRACOTTA = 0xb5643c, LEAF = 0x3f5a2e, WOOD = 0x6b4a32;

function flagstoneTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");
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
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function medallionTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  const ring = (r, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke(); };
  g.fillStyle = "#b89a74"; g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fill();
  ring(240, "#6e5238", 10); ring(200, "#6e5238", 6); ring(120, "#6e5238", 6);
  for (let k = 0; k < 16; k++) {                 // a simple rosette
    const a = (k / 16) * Math.PI * 2;
    g.fillStyle = k % 2 ? "#8c6a48" : "#a07c56";
    g.beginPath();
    g.ellipse(256 + Math.cos(a) * 160, 256 + Math.sin(a) * 160, 34, 14, a, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createCourtyard(scene) {
  const root = new THREE.Group();
  root.name = "courtyard";
  scene.add(root);
  const stone = new THREE.MeshStandardMaterial({ color: SAND, roughness: 0.9 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: SAND_DARK, roughness: 0.95 });
  const shadowy = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1 });
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
    return m;
  };

  // --- paved floor
  const tex = flagstoneTexture();
  tex.repeat.set(4, 13);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 52),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.005, -20);
  floor.receiveShadow = true;
  root.add(floor);

  // --- floor medallion
  const med = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48),
    new THREE.MeshStandardMaterial({ map: medallionTexture(), roughness: 0.85 }));
  med.rotation.x = -Math.PI / 2;
  med.position.set(0, 0.01, -14);
  med.receiveShadow = true;
  root.add(med);

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
  box(7.0, 11, 1.2, stone, -5.5, 5.5, F.z);
  box(7.0, 11, 1.2, stone, 5.5, 5.5, F.z);
  box(4.0, 4.6, 1.2, stone, 0, 8.7, F.z);                             // over the arch
  const archTop = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 1.2, 32, 1, false, 0, Math.PI), stone);
  archTop.rotation.z = Math.PI / 2; archTop.rotation.y = Math.PI / 2;
  archTop.position.set(0, 6.4, F.z);
  root.add(archTop);
  box(19.6, 0.6, 1.8, stoneDark, 0, 11.3, F.z);                       // cornice
  for (const x of [-8.5, -3.5, 3.5, 8.5]) box(0.7, 1.0, 0.7, stoneDark, x, 12.1, F.z);
  box(20, 11, 0.6, stoneDark, 0, 5.5, F.z - 9);                       // the next wall beyond the arch

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
