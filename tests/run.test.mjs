import assert from "node:assert";
import fs from "node:fs";
import { PRESETS, presetOf, normalize, scoreMultiplier, judgeFor, simplifyNotes } from "../src/game/run.js";

// presets are what they say; touching anything makes it Custom
for (const k of Object.keys(PRESETS)) assert.strictEqual(presetOf(PRESETS[k]), k);
assert.strictEqual(presetOf({ ...PRESETS.easy, hitbox: 0.2 }), "custom");
assert.strictEqual(normalize({ hitbox: 9, tempo: 0 }).hitbox, 0.25, "clamped");

// harder pays more; easier pays less; Easy < Medium < Hard < Expert
const m = (c) => scoreMultiplier(c).total;
assert.ok(m(PRESETS.easy) < m(PRESETS.medium) && m(PRESETS.medium) < m(PRESETS.hard) && m(PRESETS.hard) < m(PRESETS.expert), `${["easy", "medium", "hard", "expert"].map((k) => m(PRESETS[k]))}`);
assert.ok(m({ ...PRESETS.hard, tempo: 1.25 }) > m(PRESETS.hard), "faster pays more");
assert.strictEqual(m({ ...PRESETS.hard, lock: 1 }), m(PRESETS.hard), "lock size no longer changes the score (10-21: every clean hit locks)");
assert.ok(m({ ...PRESETS.hard, damage: "harsh" }) > m(PRESETS.hard), "harsher damage pays more");

// judging follows the hitbox
assert.strictEqual(judgeFor(PRESETS.easy).window, 0.25);
assert.strictEqual(judgeFor({ ...PRESETS.easy, hitbox: 0.1 }).window, 0.1);
assert.strictEqual(normalize({ lock: "all", keep: "none" }).lock, 1, "any saved group size comes back as single notes (10-21)");
assert.strictEqual(normalize({ lock: 8, keep: "half" }).keep, "any", "any saved keep rule comes back as keep-every-hit (10-21)");

// pattern difficulty: easy = beats and half-beats; medium drops fast sixteenth runs and off-grid notes; full = all
const k = (beat) => ({ lane: "kick", beat });
const notes = [0, 0.5, 1, 1.25, 1.5, 2.25, 2.5, 2.75, 3, 3.333, 3.75].map(k);
const lanes = (r) => r.play.map((n) => n.beat);
assert.deepStrictEqual(lanes(simplifyNotes(notes, "easy")), [0, 0.5, 1, 1.5, 2.5, 3]);
assert.deepStrictEqual(lanes(simplifyNotes(notes, "medium")), [0, 0.5, 1, 1.5, 2.5, 3, 3.75], "runs (1-1.25-1.5, 2.25-2.5-2.75) and the triplet go; the lone 3.75 stays");
assert.deepStrictEqual(lanes(simplifyNotes(notes, "full")), notes.map((n) => n.beat), "full: every note (one per moment here)");
const r = simplifyNotes(notes, "easy");
assert.strictEqual(r.play.length + r.backing.length, notes.length, "nothing lost: the rest goes to the backing");

// on the owner's song: Easy plays fewest, full plays all
const dope = JSON.parse(fs.readFileSync("public/songs/song1.json", "utf8"));   // Round 1, "Dope" (the game's own file)
const counts = ["easy", "medium", "full"].map((l) => simplifyNotes(dope.notes, l).play.length);
assert.ok(counts[0] < counts[1] && counts[1] <= counts[2] && counts[2] <= dope.notes.length, `Dope notes to play: ${counts}`);
for (const l of ["easy", "medium", "full"]) { const r = simplifyNotes(dope.notes, l); assert.strictEqual(r.play.length + r.backing.length, dope.notes.length, `${l}: nothing lost`); }
console.log("run ok — Dope notes to play easy/medium/full:", counts.join("/"), "| multipliers:", ["easy", "medium", "hard", "expert"].map((k) => k + " x" + m(PRESETS[k])).join(" "));

// two hands: never more than two notes at one moment at one station; the rest go to the backing
{
  const notes = [{ lane: "hat", beat: 0 }, { lane: "crash", beat: 0 }, { lane: "kick", beat: 0 }, { lane: "snare", beat: 1 }, { lane: "bass 2", beat: 0 }, { lane: "bass 10", beat: 0 }, { lane: "bass 1", beat: 0 }];
  const r = simplifyNotes(notes, "full");
  const at0 = (sec) => r.play.filter((n) => n.beat === 0 && (sec === "drums" ? !n.lane.startsWith("bass") : n.lane.startsWith("bass"))).map((n) => n.lane).sort();
  assert.deepStrictEqual(at0("drums"), ["hat", "kick"], "kick + hat stay yours, the crash goes to the band");
  assert.deepStrictEqual(at0("bass"), ["bass 1", "bass 2"], "the bottom row first");
  assert.strictEqual(r.play.length + r.backing.length, notes.length, "nothing lost");
  console.log("two hands ok");
}

// the 10-level slider: every level its own config, harder pays more, presets on 3/5/7/10
{
  const { LEVELS, levelOf } = await import("../src/game/run.js");
  assert.strictEqual(LEVELS.length, 10);
  LEVELS.forEach((c, i) => assert.strictEqual(levelOf(c), i + 1, `level ${i + 1} is found`));
  for (let i = 1; i < 10; i++) assert.ok(m(LEVELS[i]) > m(LEVELS[i - 1]), `level ${i + 1} pays more than ${i}`);
  assert.deepStrictEqual(["easy", "medium", "hard", "expert"].map((k) => levelOf(PRESETS[k])), [3, 5, 7, 10]);
  assert.strictEqual(levelOf({ ...LEVELS[4], hitbox: 0.2 }), 0, "custom");
  assert.ok(LEVELS.every((c) => c.hitbox === 0.25), "the ginormous hitbox at every level");
  console.log("levels ok");
}
