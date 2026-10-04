import assert from "node:assert";
import { midiToHit, GM_DRUMS, PAD_BUTTONS } from "../src/input/pads.js";

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
// every lane is reachable from MIDI and from a controller
const lanes = ["kick", "snare", "hat", "crash", "tom low", "tom high"];
for (const l of lanes) {
  assert.ok(Object.values(GM_DRUMS).includes(l), `MIDI reaches ${l}`);
  assert.ok(Object.values(PAD_BUTTONS).includes(l), `controller reaches ${l}`);
}
console.log("pads: all passed");

// every controller button does ONE thing (owner): LT only switches rows, no bell
{
  const { MELODY_BUTTONS, ROW_SHIFT } = await import("../src/input/pads.js");
  assert.ok(!(ROW_SHIFT in PAD_BUTTONS) && !(ROW_SHIFT in MELODY_BUTTONS), "LT is only the row switch");
  assert.deepStrictEqual(Object.values(MELODY_BUTTONS).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7], "D-pad + X A B Y cover the 8 guns of a row");
  assert.ok(!Object.values(PAD_BUTTONS).includes("bell"), "no bell button");
}
console.log("pads one-job ok");
