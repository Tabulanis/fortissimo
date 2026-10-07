// A world's sound banks (public/banks/<world>.json, built by tools/make-banks.py): every sample is in
// the game (wav + ogg), every kit fills all six drums, every pitched set has a believable root.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DRUMS as DRUM_LANES } from "../src/game/maker.js";

const worlds = JSON.parse(fs.readFileSync("public/banks/worlds.json", "utf8"));
const has = (p) => fs.existsSync("public/rounds/samples/" + p) && fs.existsSync("public/rounds/samples/" + p.replace(/\.wav$/, ".ogg"));
for (const w of worlds) {
  const B = JSON.parse(fs.readFileSync(`public/banks/${w.id}.json`, "utf8"));
  test(`${w.name}: every drum kit fills all six drums, and its samples are in the game`, () => {
    assert.ok(B.drums.length > 0);
    for (const k of B.drums) {
      assert.deepEqual(Object.keys(k.sounds).sort(), [...DRUM_LANES].sort(), k.name);
      for (const p of Object.values(k.sounds)) assert.ok(has(p), `${k.name}: ${p}`);
    }
  });
  for (const kind of ["bass", "treble"]) test(`${w.name}: ${kind} sets have their sample and a believable root`, () => {
    assert.ok(B[kind].length > 0);
    for (const b of B[kind]) {
      assert.ok(has(b.sample), `${b.name}: ${b.sample}`);
      const [lo, hi] = kind === "bass" ? [24, 60] : [48, 96];
      assert.ok(b.root >= lo && b.root <= hi, `${b.name}: root ${b.root} outside ${lo}-${hi}`);
    }
  });
}
