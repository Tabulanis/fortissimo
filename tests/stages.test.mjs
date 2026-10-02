import assert from "node:assert";
import { SONG, partArrows, isShown } from "../src/game/stages.js";

const laneIndexByName = (name) => ({
  hat: 0, snare: 1, crash: 2, kick: 3, "tom low": 4, "tom high": 5,
}[name]);

// four parts, each with a label and a show list
assert.strictEqual(SONG.parts.length, 4, "four parts");
assert.deepStrictEqual(SONG.parts[0].show, [3, 1], "part 1 shows exactly lanes 3 and 1");

// part 1 (groove: kick on 1, 3, and-of-3) over two bars from 0.5 with bar 4, beat 1
const kicks = partArrows(SONG.parts[0].part, laneIndexByName, 0.5, 4, 1, 0.5, 8.5);
const want = [0.5, 2.5, 3.0, 4.5, 6.5, 7.0];
assert.strictEqual(kicks.length, want.length, "six kicks in two bars");
for (let i = 0; i < want.length; i++) {
  assert.strictEqual(kicks[i].laneIdx, 3, `kick ${i} is lane 3`);
  assert.ok(Math.abs(kicks[i].time - want[i]) < 1e-9, `kick ${i} at ${want[i]}`);
}

// part 3 over one bar: hat eighths with the "and" of 2 skipped (7 hats)
const hats = partArrows(SONG.parts[2].part, laneIndexByName, 0, 4, 1, 0, 4);
const hatWant = [0, 0.5, 1, 2, 2.5, 3, 3.5];
assert.strictEqual(hats.length, hatWant.length, "seven hats");
for (let i = 0; i < hatWant.length; i++) {
  assert.strictEqual(hats[i].laneIdx, 0, `hat ${i} is lane 0`);
  assert.ok(Math.abs(hats[i].time - hatWant[i]) < 1e-9, `hat ${i} at ${hatWant[i]}`);
}

// visibility
assert.strictEqual(isShown(0, 0), false, "part 1 hides the hat");
assert.strictEqual(isShown(0, 3), true, "part 1 shows the kick");
assert.strictEqual(isShown(99, 0), true, "past the last part, everything is shown");

console.log("stages: all passed");
