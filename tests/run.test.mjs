import assert from "node:assert";
import fs from "node:fs";
import { PRESETS, presetOf, normalize, scoreMultiplier, judgeFor, simplifyNotes } from "../src/game/run.js";
import { roundFromProject } from "../src/game/hackbeat.js";

// presets are what they say; touching anything makes it Custom
for (const k of Object.keys(PRESETS)) assert.strictEqual(presetOf(PRESETS[k]), k);
assert.strictEqual(presetOf({ ...PRESETS.easy, hitbox: 0.2 }), "custom");
assert.strictEqual(normalize({ hitbox: 9, tempo: 0 }).hitbox, 0.25, "clamped");

// harder pays more; easier pays less; Easy < Medium < Hard < Expert
const m = (c) => scoreMultiplier(c).total;
assert.ok(m(PRESETS.easy) < m(PRESETS.medium) && m(PRESETS.medium) < m(PRESETS.hard) && m(PRESETS.hard) < m(PRESETS.expert), `${["easy", "medium", "hard", "expert"].map((k) => m(PRESETS[k]))}`);
assert.ok(m({ ...PRESETS.hard, tempo: 1.25 }) > m(PRESETS.hard), "faster pays more");
assert.ok(m({ ...PRESETS.hard, hitbox: 0.2 }) < m(PRESETS.hard), "a bigger hitbox pays less");
assert.ok(m({ ...PRESETS.hard, lock: 1 }) < m(PRESETS.hard), "a smaller lock size pays less");
assert.ok(m({ ...PRESETS.hard, damage: "harsh" }) > m(PRESETS.hard), "harsher damage pays more");

// judging follows the hitbox and keep
assert.strictEqual(judgeFor(PRESETS.easy).window, 0.14);
assert.strictEqual(normalize({ lock: "all" }).lock, Infinity, "saved 'all' comes back as Infinity");

// pattern difficulty: easy = beats and half-beats; medium drops fast sixteenth runs and off-grid notes; full = all
const k = (beat) => ({ lane: "kick", beat });
const notes = [0, 0.5, 1, 1.25, 1.5, 2.25, 2.5, 2.75, 3, 3.333, 3.75].map(k);
const lanes = (r) => r.play.map((n) => n.beat);
assert.deepStrictEqual(lanes(simplifyNotes(notes, "easy")), [0, 0.5, 1, 1.5, 2.5, 3]);
assert.deepStrictEqual(lanes(simplifyNotes(notes, "medium")), [0, 0.5, 1, 1.5, 2.5, 3, 3.75], "runs (1-1.25-1.5, 2.25-2.5-2.75) and the triplet go; the lone 3.75 stays");
assert.deepStrictEqual(lanes(simplifyNotes(notes, "full")), notes.map((n) => n.beat));
const r = simplifyNotes(notes, "easy");
assert.strictEqual(r.play.length + r.backing.length, notes.length, "nothing lost: the rest goes to the backing");

// on the owner's song: Easy plays fewest, full plays all
const dope = roundFromProject(JSON.parse(fs.readFileSync("../Hackbeat/projects/Dope.json", "utf8")));
const counts = ["easy", "medium", "full"].map((l) => simplifyNotes(dope.notes, l).play.length);
assert.ok(counts[0] < counts[1] && counts[1] <= counts[2] && counts[2] === dope.notes.length, `Dope notes to play: ${counts}`);
console.log("run ok — Dope notes to play easy/medium/full:", counts.join("/"), "| multipliers:", ["easy", "medium", "hard", "expert"].map((k) => k + " x" + m(PRESETS[k])).join(" "));
