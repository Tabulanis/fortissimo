// kit.js: a song's empty slots stand in for its busiest instruments — notes dealt round, pitches kept
import assert from "node:assert/strict";
import { fillKit, MIN_NOTES_TO_SHARE } from "../src/game/kit.js";

const DRUMS = ["hat", "snare", "crash", "kick", "tom low", "tom high"];
const BASS_LOW = Array.from({ length: 8 }, (_, i) => `bass ${i + 1}`);

// Dope-like: kick on every beat, snare on 2 and 4, hats on the eighths; no crash, no toms
{
  const notes = [
    ...Array.from({ length: 16 }, (_, b) => ({ lane: "kick", beat: b })),
    ...[1, 3, 5, 7, 9, 11, 13, 15].map((b) => ({ lane: "snare", beat: b })),
    ...Array.from({ length: 32 }, (_, i) => ({ lane: "hat", beat: i / 2 })),
  ];
  const { notes: out, aliases } = fillKit(notes, [DRUMS]);
  assert.equal(out.length, notes.length, "nothing invented, nothing lost");
  // the three empties go to the busiest first: hat (32), kick (16), snare (8) -> crash:hat, tom low:kick, tom high:snare
  assert.deepEqual(aliases, { crash: "hat", "tom low": "kick", "tom high": "snare" });
  const by = (l) => out.filter((n) => n.lane === l);
  assert.equal(by("kick").length + by("tom low").length, 16, "the kick's notes are shared with its stand-in");
  assert.equal(by("tom low").length, 8, "dealt in turn: half each");
  assert.ok(by("tom low").every((n) => n.sound === "kick"), "a stand-in note knows whose sound it is");
  assert.ok(by("kick").every((n) => !n.sound), "the owner's own notes are untouched");
  // dealt in time order: kick, tom low, kick, tom low...
  const kicks = out.filter((n) => n.lane === "kick" || n.lane === "tom low").sort((a, b) => a.beat - b.beat);
  assert.deepEqual(kicks.slice(0, 4).map((n) => n.lane), ["kick", "tom low", "kick", "tom low"]);
}
// guns: three bars used in a row of eight -> the other five double the busiest ones
{
  const notes = [...Array.from({ length: 12 }, (_, b) => ({ lane: "bass 1", beat: b, midi: 40 })), ...Array.from({ length: 8 }, (_, b) => ({ lane: "bass 3", beat: b + 0.5, midi: 43 })), { lane: "bass 5", beat: 2, midi: 45 }];
  const { notes: out, aliases } = fillKit(notes, [BASS_LOW]);
  assert.equal(Object.keys(aliases).length, 5, "five empties filled");
  assert.ok(Object.values(aliases).every((o) => o === "bass 1" || o === "bass 3"), "bass 5 (one note) lends nothing");
  assert.ok(out.filter((n) => n.sound === "bass 1").every((n) => n.midi === 40), "a stand-in note keeps its pitch");
  assert.ok(new Set(out.map((n) => n.lane)).size === 8, "every gun in the row now fires");
}
// a full kit is left alone; a quiet instrument isn't shared
{
  const full = DRUMS.map((l, i) => ({ lane: l, beat: i }));
  assert.deepEqual(fillKit(full, [DRUMS]).aliases, {});
  const quiet = [{ lane: "kick", beat: 0 }, { lane: "kick", beat: 2 }];
  assert.deepEqual(fillKit(quiet, [DRUMS]).aliases, {}, `under ${MIN_NOTES_TO_SHARE} notes: nothing to share`);
}
console.log("kit ok");
