/* stations.js — the two melody instruments around the player (drums are ahead):
 *   BASS   to the RIGHT (+x), bronze marimba bars
 *   TREBLE to the LEFT  (-x), silvery chime bars
 * Eight bars each, at waist height and in stick reach, low notes on the LEFT as
 * you face the instrument (so the D-pad half is the left four, XABY the right
 * four). Resonator tubes under the bars, on a dark wooden frame.
 *
 * Each bar exposes `top` (centre of its striking face, world), `normal` (+y)
 * and `radius` — the same shape as a drum head, so arrows, hits and VR
 * striking can treat bars and drums alike. */
import * as THREE from "three";

export const BAR_Y = 0.86;        // top of the bars (waist height)
export const BAR_NEAR = 0.7;      // distance from the player's centre to the bars' near edge
export const BAR_MID_Z = 0.6;     // the row's centre along z (behind the drum line: drums stay out of the stations' view)
const PITCH = 0.165;              // bar spacing along the row
const BAR_W = 0.13, BAR_T = 0.04;

const KIND = {
  bass:   { side: +1, len: [0.42, 0.30], tube: [0.55, 0.28], bar: 0xd08a3e, metal: 0.75, rough: 0.3 },
  treble: { side: -1, len: [0.30, 0.20], tube: [0.30, 0.14], bar: 0xeae4d4, metal: 0.8, rough: 0.2 },
};

function labelTexture(text) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.font = "bold 84px system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = 10; g.strokeStyle = "rgba(0,0,0,0.55)"; g.strokeText(text, 64, 70);
  g.fillStyle = "#fff8ec"; g.fillText(text, 64, 70);
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
  // low -> high runs left -> right as you face the station:
  // facing +x your left is -z; facing -x your left is +z
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const len = K.len[0] + (K.len[1] - K.len[0]) * t;
    const z = BAR_MID_Z + s * (i - 3.5) * PITCH;
    const x = s * (BAR_NEAR + len / 2);
    const mat = barMat.clone();   // own material: each bar lights up on its own
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, BAR_T, BAR_W), mat);
    bar.position.set(x, BAR_Y - BAR_T / 2, z);
    bar.castShadow = true; bar.receiveShadow = true;
    group.add(bar);
    // resonator tube hanging under the bar's middle, shorter for higher notes
    const tl = K.tube[0] + (K.tube[1] - K.tube[0]) * t;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, tl, 14), tubeMat);
    tube.position.set(x, BAR_Y - BAR_T - 0.03 - tl / 2, z);
    tube.castShadow = true;
    group.add(tube);
    // the key / button label, lying on the bar near the player, reading upright from them
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13),
      new THREE.MeshBasicMaterial({ map: labelTexture(labels[i]), transparent: true, depthWrite: false }));
    lab.rotation.set(-Math.PI / 2, 0, 0, "YXZ");
    lab.rotation.y = -s * Math.PI / 2;
    lab.position.set(s * (BAR_NEAR + 0.08), BAR_Y + 0.002, z);
    group.add(lab);
    bars.push({ mesh: bar, mat, label: lab, top: new THREE.Vector3(x, BAR_Y, z), normal: new THREE.Vector3(0, 1, 0), radius: BAR_W / 2, len });
  }
  // frame: two rails under the bar ends, four legs
  const zLo = BAR_MID_Z - 3.5 * PITCH - 0.1, zHi = BAR_MID_Z + 3.5 * PITCH + 0.1;
  const xNear = s * (BAR_NEAR + 0.04), xFar = s * (BAR_NEAR + K.len[0] - 0.04);
  for (const x of [xNear, xFar]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, zHi - zLo), woodMat);
    rail.position.set(x, BAR_Y - BAR_T - 0.03, (zLo + zHi) / 2);
    rail.castShadow = true;
    group.add(rail);
    for (const z of [zLo + 0.03, zHi - 0.03]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, BAR_Y - BAR_T - 0.03, 0.045), woodMat);
      leg.position.set(x, (BAR_Y - BAR_T - 0.03) / 2, z);
      leg.castShadow = true;
      group.add(leg);
    }
  }
  // a lantern for this station (no shadow: one shadow-casting lantern is enough)
  if (withLamp) {
    const lamp = new THREE.SpotLight(0xffb36a, 24, 6, Math.PI / 4, 0.6, 1.4);
    lamp.position.set(-s * 0.2, 2.6, BAR_MID_Z);
    lamp.target.position.set(s * (BAR_NEAR + 0.3), BAR_Y, BAR_MID_Z);
    group.add(lamp, lamp.target);
  }

  return {
    kind, group, bars,
    setLabels(texts) { bars.forEach((b, i) => { b.label.material.map.dispose(); b.label.material.map = labelTexture(texts[i]); b.label.material.needsUpdate = true; }); },
  };
}
