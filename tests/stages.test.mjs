import assert from "node:assert";
import { ROUNDS, partArrows, songOf } from "../src/game/stages.js";
const SONG = ROUNDS[0];

const laneIndexByName = (name) => ({
  hat: 0, snare: 1, crash: 2, kick: 3, "tom low": 4, "tom high": 5,
}[name]);

// six parts: four drum parts, then bass, then treble
assert.strictEqual(SONG.parts.length, 6, "six parts");
assert.deepStrictEqual(SONG.parts.map((p) => p.mode), ["drums", "drums", "drums", "drums", "bass", "treble"]);

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

// three rounds, four parts each
assert.strictEqual(ROUNDS.length, 3, "three rounds");
for (const r of ROUNDS) {
  assert.deepStrictEqual(r.parts.map((p) => p.mode), ["drums", "drums", "drums", "drums", "bass", "treble"], `${r.name}: drums, bass, treble`);
  assert.ok(r.key && r.scale, `${r.name}: has a key and scale`);
  for (const p of r.parts.slice(4)) {
    assert.ok(p.part.every((n) => new RegExp(`^${p.mode} [1-8]$`).test(n.lane)), `${r.name} ${p.mode}: lanes are its 8 bars`);
    assert.ok(p.part.every((n) => n.beat >= 0 && n.beat < 4 * p.bars), `${r.name} ${p.mode}: notes inside its ${p.bars} bars`);
  }
}
assert.strictEqual(ROUNDS[2].parts[5].bars, 4, "round 3 treble is a 4-bar take");
const fill = (r) => r.parts[3].part.filter((n) => n.lane.startsWith("tom")).map((n) => n.beat);
// round 1: singles (one high tom, one low tom); round 3: doubles (sixteenths)
assert.deepStrictEqual(fill(ROUNDS[0]), [3, 3.5], "round 1 fill is singles");
assert.deepStrictEqual(fill(ROUNDS[2]), [3, 3.25, 3.5, 3.75], "round 3 fill is doubles");
// round 2 is swung: every "and" sits 2/3 through its beat, none on the straight half
const r2 = ROUNDS[1].parts.flatMap((p) => p.part.map((n) => n.beat % 1));
assert.ok(r2.some((f) => Math.abs(f - 2 / 3) < 1e-9), "round 2 has swung offbeats");
assert.ok(!r2.some((f) => Math.abs(f - 0.5) < 1e-9), "round 2 has no straight offbeats");
// round 2 stays singles: no two notes on one drum closer than an eighth
for (const p of ROUNDS[1].parts) {
  const byLane = {};
  for (const n of p.part) (byLane[n.lane] ||= []).push(n.beat);
  for (const bs of Object.values(byLane)) {
    bs.sort((a, b) => a - b);
    for (let i = 1; i < bs.length; i++) assert.ok(bs[i] - bs[i - 1] > 0.3, "round 2: no doubles");
  }
}

// the engine plays a built-in round as one SONG: every note, looped over its longest part
for (const r of ROUNDS) {
  const s = songOf(r);
  assert.strictEqual(s.notes.length, r.parts.reduce((n, p) => n + p.part.length, 0), `${r.name}: every note`);
  assert.strictEqual(s.bars, Math.max(...r.parts.map((p) => p.bars)), `${r.name}: the longest part's bars`);
  assert.ok(s.bpm > 0);
}
console.log("stages: all passed");
