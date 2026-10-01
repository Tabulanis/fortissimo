import assert from "node:assert";
import { nearestBeat, nearestOnGrid, nearestInLoop, velocityFor, label, isOffChart, OFF_CHART } from "../src/game/judge.js";

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

// loop-wrapped judging: a press just before a loop boundary is EARLY against
// beat 0 of the NEXT loop, not late against the previous loop's last note.
const l1 = nearestInLoop([0, 2], 16, 0.5, 0.6, 0.5 + 0.03);
assert.strictEqual(l1.beat, 0);
assert.ok(Math.abs(l1.offset - 0.03) < 1e-9, "late press -> offset ~ +0.03, beat 0");

const l2 = nearestInLoop([0], 16, 0.5, 0.6, 0.5 + 16 * 0.6 - 0.04);
assert.strictEqual(l2.beat, 0);
assert.ok(Math.abs(l2.offset - (-0.04)) < 1e-9, "pre-boundary press -> offset ~ -0.04 (next loop's beat 0, EARLY)");
assert.ok(Math.abs(l2.time - (0.5 + 16 * 0.6)) < 1e-9, "matched note's absolute time is returned");

assert.strictEqual(nearestInLoop([], 16, 0.5, 0.6, 1.0), null);

// off-chart presses: null judge, or |offset| beyond OFF_CHART
assert.strictEqual(isOffChart(null), true, "null judge is off-chart");
assert.strictEqual(isOffChart({ offset: 0.1 }), false, "0.1 s is on-chart");
assert.strictEqual(isOffChart({ offset: -0.4 }), true, "-0.4 s is off-chart");
assert.ok(OFF_CHART === 0.25, "OFF_CHART constant");

console.log("judge: all passed");
