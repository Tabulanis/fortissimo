// PACING (10-21, the gameplay pass D): after 3 passes with nothing new locked in the last one, the section's rest goes to the band
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Defend } from "../src/game/defend.js";

const song = JSON.parse(readFileSync(new URL("../public/songs/song1.json", import.meta.url)));
const make = () => new Defend({ notes: song.notes, bars: song.bars }, { density: "easy", keep: "any", lockSize: 1, passes: 3, rng: () => 0.5 });
const L = 4 * song.bars;

test("a stuck player is carried on after three passes", () => {
  const d = make(); const s0 = d.section;
  let carried = null;
  for (let b = 0; b < 5 * L && !carried; b += 0.25) { d.now = b; d.tick(); for (const e of d.drain()) if (e.type === "carried") carried = { at: b, e }; }
  assert.ok(carried, "carried"); assert.equal(carried.e.section, s0);
  assert.ok(carried.at >= 3 * L && carried.at < 4 * L, `carried during pass 4 (beat ${carried.at}, loop ${L})`);
  assert.notEqual(d.section, s0, "the song moved on to the next section");
});

test("a player still locking notes keeps the section", () => {
  const d = make(); const s0 = d.section;
  let carriedAt = null;
  for (let b = 0; b < 6 * L; b += 0.25) {
    d.now = b;
    if (Math.abs(b % L - 1) < 1e-9) { const o = d.offered()[0]; if (o) d.hit(o.id, { offset: 0, velocity: 1 }); }   // one clean lock every pass
    d.tick(); for (const e of d.drain()) if (e.type === "carried" && carriedAt === null) carriedAt = b;
    if (d.section !== s0) break;
  }
  assert.ok(carriedAt === null || carriedAt >= 6 * L || d.section === s0 || d.locked.size > 5, `not carried while locking (carried at ${carriedAt})`);
  assert.ok(carriedAt === null, `never carried while a note locks every pass (was carried at beat ${carriedAt})`);
});
