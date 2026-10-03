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
  const barMat = new THREE.MeshStandardMaterial({ color: K.bar, metalness: K.metal, roughness: K.rough, emissive: 0x000000 });
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0x5a4022, metalness: 0.7, roughness: 0.45 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.8 });

  const bars = [];
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
    const t = i / (BARS - 1), row = i < PER_ROW ? 0 : 1, j = i % PER_ROW;
    const len = K.len[0] + (K.len[1] - K.len[0]) * t;
    const z = BAR_MID_Z + s * (j - (PER_ROW - 1) / 2) * PITCH;
    const lx = s * (len / 2);                       // along the row, from its near edge
    const rg = rowGroups[row];
    const mat = barMat.clone();   // own material: each bar lights up on its own
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, BAR_T, BAR_W), mat);
    bar.position.set(lx, -BAR_T / 2, z);
    bar.castShadow = true; bar.receiveShadow = true;
    rg.add(bar);
    // resonator tube hanging under the bar's middle, shorter for higher notes
    const tl = K.tube[0] + (K.tube[1] - K.tube[0]) * t;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, tl, 12), tubeMat);
    tube.position.set(lx, -BAR_T - 0.03 - tl / 2, z);
    tube.castShadow = true;
    rg.add(tube);
    // the key / button label, lying on the bar near the player, reading upright from them
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11),
      new THREE.MeshBasicMaterial({ map: labelTexture(labels[i]), transparent: true, depthWrite: false }));
    lab.rotation.set(-Math.PI / 2, 0, 0, "YXZ");
    lab.rotation.y = -s * Math.PI / 2;
    lab.position.set(s * 0.07, 0.002, z);
    rg.add(lab);
    // world-space face centre + normal (arrows, hits and VR striking use these)
    rg.updateMatrixWorld(true);
    const top = new THREE.Vector3(lx, 0, z).applyMatrix4(rg.matrixWorld);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rg.quaternion);
    bars.push({ mesh: bar, mat, label: lab, top, normal, radius: BAR_W / 2, len, row });
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
