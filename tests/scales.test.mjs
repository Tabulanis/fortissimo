import assert from "node:assert";
import { instrumentNotes, keyRoot, noteName, slotOf, BASS_OCTAVE, TREBLE_OCTAVE } from "../src/game/scales.js";

assert.strictEqual(keyRoot("C", 4), 60, "middle C");
// C major, treble register: C5 D5 E5 F5 G5 A5 B5 C6
const t = instrumentNotes({ key: "C", scale: "major", octave: TREBLE_OCTAVE });
assert.deepStrictEqual(t.map(noteName), ["C5", "D5", "E5", "F5", "G5", "A5", "B5", "C6"]);
assert.strictEqual(t.length, 8);
// A minor bass: A2 B2 C3 D3 E3 F3 G3 A3
const b = instrumentNotes({ key: "A", scale: "minor", octave: BASS_OCTAVE });
assert.deepStrictEqual(b.map(noteName), ["A2", "B2", "C3", "D3", "E3", "F3", "G3", "A3"]);
// expert: one below and one above -> 10
const e = instrumentNotes({ key: "C", scale: "major", octave: TREBLE_OCTAVE, expert: true });
assert.strictEqual(e.length, 10);
assert.deepStrictEqual([noteName(e[0]), noteName(e[9])], ["B4", "D6"]);
assert.deepStrictEqual(e.slice(1, 9), t, "expert keeps the same 8 in the middle");
// slots: which button plays a note
assert.strictEqual(slotOf(t, 79), 4, "G5 (MIDI 79) is the 5th slot");
assert.strictEqual(slotOf(t, 67), -1, "G4 is an octave below this instrument");
assert.strictEqual(slotOf(t, 73), -1, "C#5 isn't in C major");
// always rising, 7 scale steps + the octave
for (const s of ["major", "minor", "dorian", "mixolydian", "harmonicMinor"]) {
  const n = instrumentNotes({ key: "Eb", scale: s, octave: 3 });
  assert.ok(n.every((x, i) => i === 0 || x > n[i - 1]), `${s} rises`);
  assert.strictEqual(n[7] - n[0], 12, `${s} spans an octave`);
}
assert.throws(() => instrumentNotes({ key: "H", octave: 3 }));
console.log("scales ok");
