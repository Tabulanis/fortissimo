import assert from "node:assert";
import { nearestBeat, nearestOnGrid, velocityFor, label } from "../src/game/judge.js";

assert.strictEqual(velocityFor(0), 1);
assert.strictEqual(velocityFor(0.02), 1);
assert.strictEqual(velocityFor(-0.2), 0.15);
assert.ok(velocityFor(0.085) > 0.5 && velocityFor(0.085) < 0.6, "velocityFor(0.085) in (0.5, 0.6)");

// non-increasing over |offset| from 0 to 0.2 in 1 ms steps
let prev = Infinity;
for (let ms = 0; ms <= 200; ms++) {
  const v = velocityFor(ms / 1000);
  assert.ok(v <= prev + 1e-12, `velocityFor(${ms} ms) must be non-increasing`);
  prev = v;
}

const j = nearestBeat([0, 0.6, 1.2], 0.65);
assert.strictEqual(j.index, 1);
assert.ok(Math.abs(j.offset - 0.05) < 1e-9, "offset ~ 0.05");

assert.strictEqual(label(0.04), "HIT");
assert.strictEqual(label(-0.07), "EARLY");
assert.strictEqual(label(0.09), "LATE");

// regression: an early press must be judged EARLY against the grid,
// not LATE against the previous scheduled beat (the old +388 ms bug).
const g1 = nearestOnGrid(0.5, 0.6, 1.1 - 0.2);
assert.strictEqual(g1.index, 1);
assert.ok(Math.abs(g1.offset - (-0.2)) < 1e-9, "early press -> offset ~ -0.2, not +0.4");
const g0 = nearestOnGrid(0.5, 0.6, 0.0);
assert.strictEqual(g0.index, 0);

console.log("judge: all passed");
