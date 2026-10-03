import assert from "node:assert";
import { Bell } from "../src/game/bell.js";
import { DIFFICULTY } from "../src/game/difficulty.js";

// Easy: keep what you got right — two half-passes finish a step
const beat = 0.5, part = [0, 1, 2, 3].map((b) => ({ lane: b % 2 ? "snare" : "kick", beat: b }));
const run = (diff) => {
  const bell = new Bell({ first: 0, beatDur: beat });
  bell.ring(0.1);                      // records from the next bar (t = 2.0)
  const out = [];
  const bar = (start, idx) => {
    for (const i of idx) bell.add({ lane: part[i].lane, t: start + part[i].beat * beat, velocity: 0.9 });
    for (let t = start; t < start + 2.2; t += 0.01) { const r = bell.tick(t, { part, diff, free: false }); if (r) { out.push(r); break; } }
  };
  bar(2, [0, 1]);                      // first pass: only the first two notes
  bar(4, [2, 3]);                      // second pass: only the other two
  return out;
};
const easy = run(DIFFICULTY.easy);
assert.strictEqual(easy[0].locked, false, "half a step doesn't lock");
assert.strictEqual(easy[1].locked, true, "the other half finishes it");
assert.deepStrictEqual(easy[1].layer.hits.map((h) => h.lane + "@" + (h.pos / beat).toFixed(2)).sort(), ["kick@0.00", "kick@2.00", "snare@1.00", "snare@3.00"], "the loop holds all four");
const normal = run(DIFFICULTY.normal);
assert.ok(normal.every((r) => !r.locked), "Normal doesn't keep: each pass must stand alone");
console.log("keep ok");
