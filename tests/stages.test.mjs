import assert from "node:assert";
import { SONG, ROUNDS, partArrows, isShown, buildUp, EASY_STEP_NOTES } from "../src/game/stages.js";

const laneIndexByName = (name) => ({
  hat: 0, snare: 1, crash: 2, kick: 3, "tom low": 4, "tom high": 5,
}[name]);

// six parts: four drum parts, then bass, then treble
assert.strictEqual(SONG.parts.length, 6, "six parts");
assert.deepStrictEqual(SONG.parts.map((p) => p.mode), ["drums", "drums", "drums", "drums", "bass", "treble"]);
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
assert.strictEqual(isShown(SONG, 0, 0), false, "part 1 hides the hat");
assert.strictEqual(isShown(SONG, 0, 3), true, "part 1 shows the kick");
assert.strictEqual(isShown(SONG, 99, 0), true, "past the last part, everything is shown");

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

// EASY build-up: hats split into the on-beat core + the in-between add-on; tiny parts stay whole
{
  const easy = buildUp(ROUNDS[0]);
  const hatParts = easy.parts.filter((p) => p.part.some((n) => n.lane === "hat"));
  assert.deepStrictEqual(hatParts.map((p) => p.part.map((n) => n.beat)), [[0, 1, 2, 3], [0.5, 2.5, 3.5]], "hats: core then add-on");
  assert.ok(hatParts[1].addOn && hatParts[1].label.endsWith("add"));
  const kick = easy.parts.find((p) => p.part.some((n) => n.lane === "kick"));
  assert.deepStrictEqual(kick.part.map((n) => n.beat), [0, 2, 2.5], "kick stays whole (its add-on would be one note)");
  // nothing lost, nothing added: the same notes, just taught in more steps
  const all = (r) => r.parts.flatMap((p) => p.part.map((n) => `${n.lane}@${n.beat}`)).sort();
  for (const r of ROUNDS) assert.deepStrictEqual(all(buildUp(r)), all(r), `${r.name}: same notes`);
  // modes keep their order: every drums step before bass before treble
  const order = easy.parts.map((p) => p.mode);
  assert.ok(order.lastIndexOf("drums") < order.indexOf("bass") && order.lastIndexOf("bass") < order.indexOf("treble"));
}
// EASY melody: no more than four notes per step, most important first
for (const r of ROUNDS) {
  const easy = buildUp(r);
  for (const kind of ["bass", "treble"]) {
    const steps = easy.parts.filter((p) => p.mode === kind);
    assert.ok(steps.every((p) => p.part.length <= EASY_STEP_NOTES), `${r.name} ${kind}: <= 4 notes per step`);
    const whole = r.parts.find((p) => p.mode === kind).part.map((n) => `${n.lane}@${n.beat}`).sort();
    assert.deepStrictEqual(steps.flatMap((p) => p.part.map((n) => `${n.lane}@${n.beat}`)).sort(), whole, `${r.name} ${kind}: the steps add up to the whole line`);
  }
}
{
  // round 1's treble (8 notes on beats 0..7): bar downbeats and beat 3s first
  const t = buildUp(ROUNDS[0]).parts.filter((p) => p.mode === "treble");
  assert.deepStrictEqual(t.map((p) => p.part.map((n) => n.beat)), [[0, 2, 4, 6], [1, 3, 5, 7]]);
  const r3 = buildUp(ROUNDS[2]).parts.filter((p) => p.mode === "treble");
  assert.deepStrictEqual(r3.map((p) => p.part.length), [4, 4, 4, 3], "round 3's 15-note treble: 4 + 4 + 4 + 3");
}
console.log("stages: all passed");
