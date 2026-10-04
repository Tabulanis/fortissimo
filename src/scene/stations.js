/* stations.js — the two melody instruments around the player (drums are ahead):
 *   BASS   to the RIGHT (+x), bronze marimba bars
 *   TREBLE to the LEFT  (-x), silvery chime bars
 * Sixteen bars each in TWO ROWS OF EIGHT (owner, 2026-10-03), like a two-tier
 * marimba: the BOTTOM row (near, lower) = keys A S D F G H J K = the 8 pad
 * buttons; the TOP row (behind, well raised, tilted to face the player) =
 * Q W E R T Y U I = the same 8 buttons with LT held. Each row runs left ->
 * right. Resonator tubes, dark wooden frame.
 *
 * Each bar exposes `top` (centre of its striking face, world), `normal` (+y)
 * and `radius` — the same shape as a drum head, so arrows, hits and VR
 * striking can treat bars and drums alike. */
import * as THREE from "three";

export const BAR_Y = 0.86;        // top of the BOTTOM row (waist height); the top row sits ROW_RISE higher
export const BAR_NEAR = 0.55;     // distance from the player's centre to the bottom row's near edge
const ROW_RISE = 0.5, ROW_GAP = 0.03;   // top row well above the bottom: the rows read apart (tablets especially)
const TOP_TILT = 0.7;             // radians (~40°): the top row's face turns toward the player
const TOP_OVERLAP = 0.45;         // the top row starts this far back over the bottom row's bars (fraction of their length): close, not a second table
export const PER_ROW = 8, BARS = 16;
export const BAR_MID_Z = 0.6;     // the row's centre along z (behind the drum line: drums stay out of the stations' view)
const PITCH = 0.175;              // bar spacing along a row (8 bars ~1.4 m: within reach)
const BAR_W = 0.15, BAR_T = 0.04;

const KIND = {
  bass:   { side: +1, len: [0.34, 0.24], tube: [0.55, 0.28], bar: 0xd08a3e, metal: 0.7, rough: 0.45 },
  treble: { side: -1, len: [0.26, 0.17], tube: [0.30, 0.14], bar: 0xeae4d4, metal: 0.75, rough: 0.4 },
};

function labelTexture(text) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.lineWidth = 10; g.strokeStyle = "rgba(0,0,0,0.55)"; g.fillStyle = "#fff8ec";
  const DPAD = { dL: Math.PI, dD: Math.PI / 2, dR: 0, dU: -Math.PI / 2 };   // D-pad arrows, drawn (no font needed)
  if (text.startsWith("LT:")) {
    // a top-row pad label: the button, smaller, under a small "LT" (hold LT for this row)
    text = text.slice(3);
    g.font = "bold 34px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 6; g.strokeText("LT", 64, 20); g.fillText("LT", 64, 20);
    g.translate(64, 76); g.scale(0.7, 0.7); g.translate(-64, -64); g.lineWidth = 10;
  }
  if (text in DPAD) {
    const a = DPAD[text], tri = [[44, 0], [-30, -36], [-30, 36]].map(([x, y]) => [64 + x * Math.cos(a) - y * Math.sin(a), 64 + x * Math.sin(a) + y * Math.cos(a)]);
    g.beginPath(); tri.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.stroke(); g.fill();
  } else {
    g.font = "bold 84px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.strokeText(text, 64, 70); g.fillText(text, 64, 70);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param {THREE.Scene} scene
 * @param {"bass"|"treble"} kind
 * @param {{labels?: string[]}} opts
 */
export const KEY_LABELS = [..."ASDFGHJK", ..."QWERTYUI"];
export function createStation(scene, kind, { labels = KEY_LABELS, lamp: withLamp = true } = {}) {
  const K = KIND[kind];
  const s = K.side;   // +1 right (+x), -1 left (-x)
  const group = new THREE.Group();
  group.name = "station-" + kind;
  scene.add(group);
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.8 });

  const bars = [];
  // THE TOP ROW IS CANNONS (owner, 2026-10-03; placeholder until real assets):
  // a carriage you strike (its key on it) and a bronze barrel aimed outward and
  // up at the archers on the roofs; a hit, yours or the band's, fires a bolt
  // from the muzzle (defense.js). Same target shape as a bar: top / normal / radius.
  const cannonMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 0.85, roughness: 0.35, emissive: 0x000000 });
  const carriageMat = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.75 });
  // MORTARS on the bottom row: short and wide, angled up and a little outward, lobbing high
  function makeMortar(rg, i, z) {
    const mat = cannonMat.clone();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.05, 16), carriageMat);
    base.position.set(s * 0.1, 0.025, z);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.17, 16), mat);
    barrel.rotation.z = -s * 0.35;   // up, leaning out
    barrel.position.set(s * 0.12, 0.13, z);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.054, 0.01, 8, 18), mat);
    lip.position.set(0, 0.085, 0); lip.rotation.x = Math.PI / 2;
    barrel.add(lip);
    for (const m of [base, barrel]) { m.castShadow = true; m.receiveShadow = true; rg.add(m); }
    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(labels[i]), transparent: true, depthWrite: false }));
    lab.scale.setScalar(0.085);
    lab.position.set(s * 0.0, 0.17, z);
    rg.add(lab);
    rg.updateMatrixWorld(true);
    const top = new THREE.Vector3(s * 0.06, 0.06, z).applyMatrix4(rg.matrixWorld);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rg.quaternion);
    const muzzle = barrel.localToWorld(new THREE.Vector3(0, 0.1, 0));
    return { mesh: barrel, mat, label: lab, top, normal, radius: 0.08, len: 0.17, row: 0, mortar: true, muzzle };
  }
  function makeCannon(rg, i, z) {
    const mat = cannonMat.clone();   // its own: it lights up on its own
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.12), carriageMat);
    carriage.position.set(s * 0.09, 0.025, z);
    const wheelGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.015, 14);
    for (const dz of [-0.065, 0.065]) {
      const w = new THREE.Mesh(wheelGeo, carriageMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(s * 0.12, 0.03, z + dz);
      rg.add(w);
    }
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.3, 16), mat);
    barrel.rotation.z = -s * (Math.PI / 2 - 0.25);   // the narrow end out and up
    barrel.position.set(s * 0.17, 0.1, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.008, 8, 18), mat);
    ring.position.set(0, 0.15, 0);
    ring.rotation.x = Math.PI / 2;
    barrel.add(ring);
    for (const m of [carriage, barrel]) { m.castShadow = true; m.receiveShadow = true; rg.add(m); }
    // its key floats just above the breech, always facing you (the barrel hid a flat one)
    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(labels[i]), transparent: true, depthWrite: false }));
    lab.scale.setScalar(0.085);
    lab.position.set(s * 0.0, 0.16, z);
    rg.add(lab);
    rg.updateMatrixWorld(true);
    const top = new THREE.Vector3(s * 0.06, 0.06, z).applyMatrix4(rg.matrixWorld);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rg.quaternion);
    const muzzle = barrel.localToWorld(new THREE.Vector3(0, 0.17, 0));
    return { mesh: barrel, mat, label: lab, top, normal, radius: 0.07, len: 0.17, row: 1, cannon: true, muzzle };
  }
  // rows: bottom = bars 0-7 (near, low), top = bars 8-15 (behind, raised and
  // tilted toward the player). Within a row, left -> right as you face the
  // station: facing +x your left is -z; facing -x your left is +z.
  const ROW_DEPTH = K.len[0];   // the bottom row's longest bar
  const rowNear = [BAR_NEAR, BAR_NEAR + ROW_DEPTH * (1 - TOP_OVERLAP) + ROW_GAP];
  const rowY = [BAR_Y, BAR_Y + ROW_RISE];
  // each row is its own group, pivoting at its near edge: the top row's far end lifts
  const rowGroups = [0, 1].map((row) => {
    const g = new THREE.Group();
    g.position.set(s * rowNear[row], rowY[row], 0);
    g.rotation.z = row ? s * TOP_TILT : 0;
    group.add(g);
    return g;
  });
  const zLo = BAR_MID_Z - (PER_ROW - 1) / 2 * PITCH - BAR_W / 2 - 0.05, zHi = BAR_MID_Z + (PER_ROW - 1) / 2 * PITCH + BAR_W / 2 + 0.05;
  for (let i = 0; i < BARS; i++) {
    const row = i < PER_ROW ? 0 : 1, j = i % PER_ROW;
    const z = BAR_MID_Z + s * (j - (PER_ROW - 1) / 2) * PITCH;
    const rg = rowGroups[row];
    // every bar is a GUN (owner, 2026-10-03): cannons on the top row, mortars on the bottom
    bars.push(row === 1 ? makeCannon(rg, i, z) : makeMortar(rg, i, z));
  }
  // frame: per row, two rails under the bar ends (tilting with the row) and legs to the floor
  for (let row = 0; row < 2; row++) {
    const rg = rowGroups[row];
    for (const d of [0.04, (row ? K.len[1] + 0.02 : K.len[0]) - 0.04]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, zHi - zLo), woodMat);
      rail.position.set(s * d, -BAR_T - 0.03, (zLo + zHi) / 2);
      rail.castShadow = true;
      rg.add(rail);
      rg.updateMatrixWorld(true);
      const railWorld = rail.getWorldPosition(new THREE.Vector3());
      for (const z of [zLo + 0.03, zHi - 0.03]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, railWorld.y, 0.045), woodMat);
        leg.position.set(railWorld.x, railWorld.y / 2, z);
        leg.castShadow = true;
        group.add(leg);
      }
    }
  }
  // a lantern for this station (no shadow: one shadow-casting lantern is enough)
  if (withLamp) {
    const lamp = new THREE.SpotLight(0xffb36a, 24, 6, Math.PI / 4, 0.6, 1.4);
    lamp.position.set(-s * 0.2, 2.6, BAR_MID_Z);
    lamp.target.position.set(s * (BAR_NEAR + 0.35), BAR_Y, BAR_MID_Z);
    group.add(lamp, lamp.target);
  }

  return {
    kind, group, bars,
    setLabels(texts) { bars.forEach((b, i) => { b.label.material.map.dispose(); b.label.material.map = labelTexture(texts[i]); b.label.material.needsUpdate = true; }); },
  };
}
