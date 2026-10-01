import assert from "node:assert";
import { SONG, partArrows, isShown } from "../src/game/stages.js";

const laneIndexByName = (name) => ({
  hat: 0, snare: 1, crash: 2, kick: 3, "tom low": 4, "tom high": 5,
}[name]);

// four parts, each with a label and a show list
assert.strictEqual(SONG.parts.length, 4, "four parts");
assert.deepStrictEqual(SONG.parts[0].show, [3, 1], "part 1 shows exactly lanes 3 and 1");

// part 1 over [0.5, 8.5): 8 kicks at 0.5, 1.5, ..., 7.5, all laneIdx 3
const kicks = partArrows(SONG.parts[0].part, laneIndexByName, 0.5, 4, 1, 0.5, 8.5);
assert.strictEqual(kicks.length, 8, "eight kicks");
for (let i = 0; i < 8; i++) {
  assert.strictEqual(kicks[i].laneIdx, 3, `kick ${i} is lane 3`);
  assert.ok(Math.abs(kicks[i].time - (0.5 + i)) < 1e-9, `kick ${i} at ${0.5 + i}`);
}

// part 3 over one bar: 8 hats
const hats = partArrows(SONG.parts[2].part, laneIndexByName, 0, 4, 1, 0, 4);
assert.strictEqual(hats.length, 8, "eight hats");
for (let i = 0; i < 8; i++) {
  assert.strictEqual(hats[i].laneIdx, 0, `hat ${i} is lane 0`);
  assert.ok(Math.abs(hats[i].time - (i * 0.5)) < 1e-9, `hat ${i} at ${i * 0.5}`);
}

// visibility
assert.strictEqual(isShown(0, 0), false, "part 1 hides the hat");
assert.strictEqual(isShown(0, 3), true, "part 1 shows the kick");
assert.strictEqual(isShown(99, 0), true, "past the last part, everything is shown");

console.log("stages: all passed");
