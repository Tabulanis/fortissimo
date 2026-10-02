import assert from "node:assert";
import { createVrHits, speedToForce, LOCKOUT_MS } from "../src/input/vrhits.js";

// one low drum (head facing up at y 0.9) and one upright drum (head facing the player, +z)
const heads = [
  { center: { x: 0, y: 0.9, z: -0.4 }, normal: { x: 0, y: 1, z: 0 }, radius: 0.2 },
  { center: { x: 0.5, y: 1.25, z: -0.5 }, normal: { x: 0, y: 0, z: 1 }, radius: 0.19 },
];

// a downward swing at 11 ms frames: tip from 0.3 m above to 0.05 m below
function swing(vr, id, head0, fromY, toY, t0, frames, dx = 0) {
  const out = [];
  for (let k = 0; k <= frames; k++) {
    const y = fromY + (toY - fromY) * (k / frames);
    out.push(...vr.step(id, { x: dx, y, z: -0.4 }, t0 + k * 11));
  }
  return out;
}

// 1. a clean downward stroke hits the low drum once
{
  const vr = createVrHits(heads);
  const hits = swing(vr, "L", 0, 1.2, 0.85, 1000, 10);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].head, 0);
  // speed: 0.35 m in 110 ms = ~3.2 m/s -> near full force
  assert.ok(hits[0].speed > 3 && hits[0].speed < 3.4, "speed " + hits[0].speed);
  assert.ok(hits[0].force > 0.9);
  // crossing time is interpolated: plane at y 0.9 is 6/7 of the way down -> ~1094 ms
  assert.ok(Math.abs(hits[0].time - (1000 + 110 * (0.3 / 0.35))) < 0.5, "time " + hits[0].time);
}

// 2. resting the stick on/inside the head does not re-trigger; lifting and striking again does
{
  const vr = createVrHits(heads);
  assert.strictEqual(swing(vr, "L", 0, 1.2, 0.85, 0, 10).length, 1);
  // jitter just around the surface (below the re-arm height): nothing
  let extra = 0;
  for (let k = 0; k < 20; k++) extra += vr.step("L", { x: 0, y: 0.9 + (k % 2 ? 0.006 : -0.006), z: -0.4 }, 200 + k * 11).length;
  assert.strictEqual(extra, 0);
  // lift and strike again -> second hit
  assert.strictEqual(swing(vr, "L", 0, 1.1, 0.85, 1000, 10).length, 1);
}

// 3. a slow touch is quiet, a fast one loud
{
  const slow = swing(createVrHits(heads), "L", 0, 0.95, 0.88, 0, 30)[0];   // 0.07 m in 330 ms
  const fast = swing(createVrHits(heads), "L", 0, 1.3, 0.85, 0, 5)[0];     // 0.45 m in 55 ms
  assert.ok(slow.force < 0.25, "slow " + slow.force);
  assert.ok(fast.force === 1, "fast " + fast.force);
  assert.ok(speedToForce(0) > 0 && speedToForce(100) === 1);
}

// 4. missing the drum (outside the rim) is no hit
{
  const vr = createVrHits(heads);
  assert.strictEqual(swing(vr, "L", 0, 1.2, 0.8, 0, 10, 0.4).length, 0);
}

// 5. coming UP from below the head is no hit (the underside isn't the playing side)
{
  const vr = createVrHits(heads);
  vr.step("L", { x: 0, y: 0.7, z: -0.4 }, 0);
  assert.strictEqual(swing(vr, "L", 0, 0.7, 0.95, 11, 10).length, 0);
}

// 6. the upright drum: a forward jab into its face (-z) hits
{
  const vr = createVrHits(heads);
  let hits = [];
  for (let k = 0; k <= 8; k++) hits.push(...vr.step("R", { x: 0.5, y: 1.25, z: -0.2 - 0.04 * k }, k * 11));
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].head, 1);
}

// 7. lockout: two sticks hitting the same drum within LOCKOUT_MS count once (flam guard)
{
  const vr = createVrHits(heads);
  vr.step("L", { x: -0.05, y: 1.0, z: -0.4 }, 0);
  vr.step("R", { x: 0.05, y: 1.0, z: -0.4 }, 0);
  const a = vr.step("L", { x: -0.05, y: 0.85, z: -0.4 }, 11);
  const b = vr.step("R", { x: 0.05, y: 0.85, z: -0.4 }, 11 + LOCKOUT_MS / 3);
  assert.strictEqual(a.length + b.length, 1);
}

// 8. a stick first seen already inside the drum doesn't fire when tracking returns
{
  const vr = createVrHits(heads);
  vr.step("L", { x: 0, y: 0.89, z: -0.4 }, 0);
  assert.strictEqual(vr.step("L", { x: 0, y: 0.8, z: -0.4 }, 11).length, 0);
  vr.drop("L");
  vr.step("L", { x: 0, y: 0.89, z: -0.4 }, 50);
  assert.strictEqual(vr.step("L", { x: 0, y: 0.85, z: -0.4 }, 61).length, 0);
}

console.log("vrhits ok");
