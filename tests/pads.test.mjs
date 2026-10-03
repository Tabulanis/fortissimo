import assert from "node:assert";
import { midiToHit, GM_DRUMS, MIDI_BELL_NOTE, PAD_BUTTONS } from "../src/input/pads.js";

// note-on on channel 10 (0x99), GM kick 36 at full force
assert.deepStrictEqual(midiToHit([0x99, 36, 127]), { lane: "kick", force: 1 });
// any channel works (0x90), snare 38 at half force
const s = midiToHit([0x90, 38, 64]);
assert.strictEqual(s.lane, "snare"); assert.ok(Math.abs(s.force - 64 / 127) < 1e-9);
// note-on with velocity 0 is a note-off: ignored
assert.strictEqual(midiToHit([0x99, 36, 0]), null);
// note-off status ignored
assert.strictEqual(midiToHit([0x89, 36, 100]), null);
// unmapped note ignored
assert.strictEqual(midiToHit([0x99, 20, 100]), null);
// cowbell rings the bell
assert.deepStrictEqual(midiToHit([0x99, MIDI_BELL_NOTE, 90]), { bell: true });
// every lane is reachable from MIDI and from a controller
const lanes = ["kick", "snare", "hat", "crash", "tom low", "tom high"];
for (const l of lanes) {
  assert.ok(Object.values(GM_DRUMS).includes(l), `MIDI reaches ${l}`);
  assert.ok(Object.values(PAD_BUTTONS).includes(l), `controller reaches ${l}`);
}
console.log("pads: all passed");

// every controller button does ONE thing (owner, 2026-10-03): LT only switches rows, B is never the bell
{
  const { MELODY_BUTTONS, ROW_SHIFT, MELODY_BELL } = await import("../src/input/pads.js");
  assert.ok(!(ROW_SHIFT in PAD_BUTTONS) && !(ROW_SHIFT in MELODY_BUTTONS), "LT is only the row switch");
  assert.ok(PAD_BUTTONS[1] === undefined && !MELODY_BELL.includes(1), "B is not the bell");
  assert.deepStrictEqual(Object.entries(PAD_BUTTONS).filter(([, v]) => v === "bell").map(([k]) => +k), [9], "the bell is Menu only");
}
console.log("pads one-job ok");
