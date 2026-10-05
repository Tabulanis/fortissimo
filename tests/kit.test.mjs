// kit.js: a song's empty slots stand in for its busiest instruments — notes dealt round, pitches kept
import assert from "node:assert/strict";
import { fillKit, kitPlan, NOTES_PER_STAND_IN } from "../src/game/kit.js";

const DRUMS = ["hat", "snare", "crash", "kick", "tom low", "tom high"];
const BASS_LOW = Array.from({ length: 8 }, (_, i) => `bass ${i + 1}`);

// Dope-like: kick on every beat, snare on 2 and 4, hats on the eighths; no crash, no toms
{
  const notes = [
    ...Array.from({ length: 16 }, (_, b) => ({ lane: "kick", beat: b })),
    ...[1, 3, 5, 7, 9, 11, 13, 15].map((b) => ({ lane: "snare", beat: b })),
    ...Array.from({ length: 32 }, (_, i) => ({ lane: "hat", beat: i / 2 })),
  ];
  const { notes: out, aliases, present } = fillKit(notes, [DRUMS]);
  assert.equal(out.length, notes.length, "nothing invented, nothing lost");
  // stand-ins are EARNED, one per 10 notes: hat (32) earns 3, kick (16) 1, snare (8) none — dealt busiest first
  assert.deepEqual(aliases, { crash: "hat", "tom low": "kick", "tom high": "hat" });
  assert.deepEqual(present[0], DRUMS, "every drum present in this round");
  const by = (l) => out.filter((n) => n.lane === l);
  assert.equal(by("kick").length + by("tom low").length, 16, "the kick's notes are shared with its stand-in");
  assert.equal(by("tom low").length, 8, "dealt in turn: half each");
  assert.equal(by("hat").length + by("crash").length + by("tom high").length, 32, "the hat's over three");
  assert.ok(by("tom low").every((n) => n.sound === "kick"), "a stand-in note knows whose sound it is");
  assert.ok(by("kick").every((n) => !n.sound), "the owner's own notes are untouched");
  // dealt in time order: kick, tom low, kick, tom low...
  const kicks = out.filter((n) => n.lane === "kick" || n.lane === "tom low").sort((a, b) => a.beat - b.beat);
  assert.deepEqual(kicks.slice(0, 4).map((n) => n.lane), ["kick", "tom low", "kick", "tom low"]);
}
// guns: three bars used in a row of eight -> the other five double the busiest ones
{
  const notes = [...Array.from({ length: 12 }, (_, b) => ({ lane: "bass 1", beat: b, midi: 40 })), ...Array.from({ length: 8 }, (_, b) => ({ lane: "bass 3", beat: b + 0.5, midi: 43 })), { lane: "bass 5", beat: 2, midi: 45 }];
  const { notes: out, aliases, present } = fillKit(notes, [BASS_LOW]);
  assert.deepEqual(aliases, { "bass 2": "bass 1" }, "bass 1 (12 notes) earns one stand-in; bass 3 (8) and bass 5 (1) none");
  assert.ok(out.filter((n) => n.sound === "bass 1").every((n) => n.midi === 40), "a stand-in note keeps its pitch");
  assert.deepEqual(present[0], ["bass 1", "bass 2", "bass 3", "bass 5"], "the round's slots: just what's needed (few, not 8)");
  const plan = kitPlan([DRUMS, present[0], [], ["treble 1"]]);
  assert.deepEqual(plan.bass.bottom, [0, 1, 2, 4]); assert.deepEqual(plan.bass.top, []); assert.deepEqual(plan.treble, { bottom: [0], top: [0, 4] });
}
// a full kit is left alone; a quiet instrument isn't shared
{
  const full = DRUMS.map((l, i) => ({ lane: l, beat: i }));
  assert.deepEqual(fillKit(full, [DRUMS]).aliases, {});
  const quiet = [{ lane: "kick", beat: 0 }, { lane: "kick", beat: 2 }];
  assert.deepEqual(fillKit(quiet, [DRUMS]).aliases, {}, `under ${NOTES_PER_STAND_IN} notes: nothing earned`);
  assert.deepEqual(fillKit(quiet, [DRUMS]).present[0], ["kick"], "a one-drum song is a one-drum kit");
}
console.log("kit ok");
