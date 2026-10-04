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

// every controller button does ONE thing (owner, 2026-10-03): no trigger shift, no bell
{
  const { MELODY_BUTTONS, pairSlots } = await import("../src/input/pads.js");
  assert.ok(!(6 in MELODY_BUTTONS), "no LT row shift at the guns");
  // D-pad = the mortars (bars 0-7), X A B Y = the cannons (bars 8-15), two neighbours each
  const cover = (btns) => btns.flatMap((b) => pairSlots(MELODY_BUTTONS[b])).sort((a, b) => a - b);
  assert.deepStrictEqual(cover([14, 13, 15, 12]), [0, 1, 2, 3, 4, 5, 6, 7], "D-pad covers the mortars");
  assert.deepStrictEqual(cover([2, 0, 1, 3]), [8, 9, 10, 11, 12, 13, 14, 15], "face buttons cover the cannons");
  assert.ok(!Object.values(PAD_BUTTONS).includes("bell"), "no bell button");
}
console.log("pads one-job ok");
