/* stations.js — the two melody instruments around the player (drums are ahead):
 *   BASS   to the RIGHT (+x), bronze marimba bars
 *   TREBLE to the LEFT  (-x), silvery chime bars
 * Eight bars each in TWO ROWS OF FOUR (owner, 2026-10-02), like a two-tier
 * marimba: the BOTTOM row (near, lower) is notes 1-4 = the D-pad, the TOP row
 * (just behind, raised) is notes 5-8 = X A B Y. Each row runs left -> right in
 * button order (left, bottom, right, top). Resonator tubes, dark wooden frame.
 *
 * Each bar exposes `top` (centre of its striking face, world), `normal` (+y)
 * and `radius` — the same shape as a drum head, so arrows, hits and VR
 * striking can treat bars and drums alike. */
import * as THREE from "three";

export const BAR_Y = 0.86;        // top of the BOTTOM row (waist height); the top row sits ROW_RISE higher
export const BAR_NEAR = 0.55;     // distance from the player's centre to the bottom row's near edge
const ROW_RISE = 0.16, ROW_GAP = 0.03;
export const BAR_MID_Z = 0.6;     // the row's centre along z (behind the drum line: drums stay out of the stations' view)
const PITCH = 0.24;               // bar spacing along a row
const BAR_W = 0.2, BAR_T = 0.04;

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
export function createStation(scene, kind, { labels = ["A", "S", "D", "F", "H", "J", "K", "L"], lamp: withLamp = true } = {}) {
  const K = KIND[kind];
  const s = K.side;   // +1 right (+x), -1 left (-x)
  const group = new THREE.Group();
  group.name = "station-" + kind;
  scene.add(group);
  const barMat = new THREE.MeshStandardMaterial({ color: K.bar, metalness: K.metal, roughness: K.rough, emissive: 0x000000 });
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0x5a4022, metalness: 0.7, roughness: 0.45 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.8 });

  const bars = [];
  // rows: bottom = notes 1-4 (near, low), top = notes 5-8 (behind, raised).
  // Within a row, left -> right as you face the station: facing +x your left
  // is -z; facing -x your left is +z.
  const ROW_DEPTH = K.len[0];   // the bottom row's longest bar
  const rowNear = [BAR_NEAR, BAR_NEAR + ROW_DEPTH + ROW_GAP];
  const rowY = [BAR_Y, BAR_Y + ROW_RISE];
  for (let i = 0; i < 8; i++) {
    const t = i / 7, row = i < 4 ? 0 : 1, j = i % 4;
    const len = K.len[0] + (K.len[1] - K.len[0]) * t;
    const z = BAR_MID_Z + s * (j - 1.5) * PITCH;
    const x = s * (rowNear[row] + len / 2);
    const barY = rowY[row];
    const mat = barMat.clone();   // own material: each bar lights up on its own
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, BAR_T, BAR_W), mat);
    bar.position.set(x, barY - BAR_T / 2, z);
    bar.castShadow = true; bar.receiveShadow = true;
    group.add(bar);
    // resonator tube hanging under the bar's middle, shorter for higher notes
    const tl = K.tube[0] + (K.tube[1] - K.tube[0]) * t;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, tl, 14), tubeMat);
    tube.position.set(x, barY - BAR_T - 0.03 - tl / 2, z);
    tube.castShadow = true;
    group.add(tube);
    // the key / button label, lying on the bar near the player, reading upright from them
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13),
      new THREE.MeshBasicMaterial({ map: labelTexture(labels[i]), transparent: true, depthWrite: false }));
    lab.rotation.set(-Math.PI / 2, 0, 0, "YXZ");
    lab.rotation.y = -s * Math.PI / 2;
    lab.position.set(s * (rowNear[row] + 0.08), barY + 0.002, z);
    group.add(lab);
    bars.push({ mesh: bar, mat, label: lab, top: new THREE.Vector3(x, barY, z), normal: new THREE.Vector3(0, 1, 0), radius: BAR_W / 2, len, row });
  }
  // frame: per row, two rails under the bar ends and four legs to the floor
  const zLo = BAR_MID_Z - 1.5 * PITCH - BAR_W / 2 - 0.05, zHi = BAR_MID_Z + 1.5 * PITCH + BAR_W / 2 + 0.05;
  for (let row = 0; row < 2; row++) {
    const railY = rowY[row] - BAR_T - 0.03;
    for (const d of [0.04, (row ? K.len[1] + 0.02 : K.len[0]) - 0.04]) {
      const x = s * (rowNear[row] + d);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, zHi - zLo), woodMat);
      rail.position.set(x, railY, (zLo + zHi) / 2);
      rail.castShadow = true;
      group.add(rail);
      for (const z of [zLo + 0.03, zHi - 0.03]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, railY, 0.045), woodMat);
        leg.position.set(x, railY / 2, z);
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
