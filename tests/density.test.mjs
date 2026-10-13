// THE DENSITIES (10-12, his spec): medium ≈ 2× easy, sometimes pairs; hard ≈ 2× medium, ~75% pairs; expert pairs always + rests
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Defend } from "../src/game/defend.js";

const seeded = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
function measure(file, density, section = "drums") {
  const s = JSON.parse(readFileSync(new URL("../public/songs/" + file, import.meta.url)));
  const d = new Defend({ notes: s.notes, bars: s.bars }, { density, keep: density === "easy" ? "any" : density === "medium" ? "half" : "none", lockSize: 1, rng: seeded(7) });
  while (d.section !== section && !d.done) d.lockAll();
  const out = { picks: 0, beats: 0, pairBeats: 0, longestRest: 0 };
  for (let k = 0; k < 4; k++) {   // four passes of the loop
    const ids = d._plan(k).map((id) => d.note(id)), byBeat = new Map();
    for (const n of ids) byBeat.set(n.beat, (byBeat.get(n.beat) || 0) + 1);
    out.picks += ids.length; out.beats += byBeat.size; for (const c of byBeat.values()) if (c > 1) out.pairBeats++;
    const bs = [...byBeat.keys()].sort((a, b) => a - b); for (let i = 1; i < bs.length; i++) out.longestRest = Math.max(out.longestRest, bs[i] - bs[i - 1]);
  }
  return { perLoop: out.picks / 4, pairShare: out.beats ? +(out.pairBeats / out.beats).toFixed(2) : 0, longestRest: out.longestRest };
}
for (const file of ["trojan-1.json", "song1.json"]) for (const section of ["drums", "bass"]) test(`${file} ${section}: the four densities climb`, () => {
  const m = Object.fromEntries(["easy", "medium", "hard", "expert"].map((x) => [x, measure(file, x, section)]));
  console.log(file, section, JSON.stringify(m));
  assert.equal(m.easy.pairShare, 0, "easy: never two at once");
  assert.ok(m.medium.perLoop > m.easy.perLoop * 1.4, "medium: about twice easy");
  assert.ok(m.hard.perLoop > m.medium.perLoop * 1.2, "hard: more than medium");
  assert.ok(m.hard.pairShare > m.medium.pairShare, "hard: more pairs than medium");
  assert.ok(m.expert.pairShare >= m.hard.pairShare - 0.05, "expert: pairs at least as often as hard");
});
