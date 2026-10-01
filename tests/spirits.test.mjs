import assert from 'node:assert';
import * as THREE from 'three';
import { createSpirits } from '../src/scene/spirits.js';

const lanes = [
  { x: -0.8, y: 1.2, z: -1.4, radius: 0.3, depth: 0.16, upright: true },
  { x: 0.0, y: 1.2, z: -1.4, radius: 0.3, depth: 0.16, upright: true },
  { x: 0.8, y: 1.2, z: -1.4, radius: 0.3, depth: 0.16, upright: true },
  { x: -0.75, y: 0.36, z: -0.25, radius: 0.32, depth: 0.36, upright: false },
  { x: 0.0, y: 0.36, z: -0.25, radius: 0.32, depth: 0.36, upright: false },
  { x: 0.75, y: 0.36, z: -0.25, radius: 0.32, depth: 0.36, upright: false },
];

const colors = lanes.map(() => new THREE.Color(1, 0.5, 0.2));
const glowTexture = new THREE.Texture();
const drumMats = lanes.map(() => new THREE.MeshStandardMaterial());
const scene = new THREE.Scene();

const spirits = createSpirits(scene, lanes, colors, glowTexture, drumMats);

const T = 5.0;
const ghost = { laneIdx: 3, time: T, velocity: 1 };

spirits.update(T - 0.5, [ghost]);
spirits.update(T, [ghost]);

// Find the lane-3 stick's tip world position.
// The stick group's pivot is at the floor drum's pivot; the tip is at local
// (0, -STICK_LENGTH, 0) after the geometry translation applied in spirits.js.
const STICK_LENGTH = 0.42;
const tipLocal = new THREE.Vector3(0, -STICK_LENGTH, 0);

// Reconstruct by walking the scene: lane-3 stick is the first Group added
// for lane 3. Simpler: createSpirits adds sticks in lane order, so find by
// checking each child Group's position against the known lane-3 pivot.
const lane3Pivot = new THREE.Vector3(lanes[3].x, lanes[3].y + 0.75, lanes[3].z - 0.35);

let tipWorld = null;
for (const child of scene.children) {
  if (child.isGroup && child.position.distanceTo(lane3Pivot) < 1e-6) {
    tipWorld = tipLocal.clone();
    child.localToWorld(tipWorld);
    break;
  }
}

assert.ok(tipWorld, 'lane-3 stick not found in scene');

const head = new THREE.Vector3(-0.75, 0.56, -0.25);
const d = tipWorld.distanceTo(head);
console.log('tip world:', tipWorld.toArray().map((v) => v.toFixed(3)).join(', '));
console.log('distance to head:', d.toFixed(4));
assert.ok(d < 0.03, `tip not on the head point (d=${d})`);

console.log('spirits: all passed');
