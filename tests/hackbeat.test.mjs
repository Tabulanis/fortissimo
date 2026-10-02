import assert from "node:assert";
import { ROUNDS } from "../src/game/stages.js";
import { roundFromProject, projectFromRound, cellEvents, DRUM_LANES } from "../src/game/hackbeat.js";

const samples = Object.fromEntries(DRUM_LANES.map((l) => [l, `garden/${l.replace(" ", "_")}.wav`]));
const key = (n) => `${n.lane}@${n.beat.toFixed(4)}`;

// every current round survives a trip into a Hackbeat project and back, note for note
for (const r of ROUNDS) {
  const swing = r.swing ? 2 / 3 : 0;
  const proj = projectFromRound({ ...r, swing }, { samples });
  // looks like a Hackbeat project
  assert.strictEqual(proj.kind, "tracker");
  assert.strictEqual(proj.patterns.length, r.parts.length);
  assert.strictEqual(proj.channels.slice(0, 6).map((c) => c.name).join(","), DRUM_LANES.join(","));
  assert.ok(proj.patterns.every((p) => p.data.length === p.rows && p.data.every((row) => row.length === proj.channels.length)));
  const back = roundFromProject(JSON.parse(JSON.stringify(proj)), { swing, key: r.key, scale: r.scale });
  assert.strictEqual(back.parts.length, r.parts.length, `${r.name}: part count`);
  r.parts.forEach((p, i) => {
    assert.deepStrictEqual(back.parts[i].part.map(key).sort(), p.part.map(key).sort(), `${r.name} part ${i + 1} notes`);
    assert.strictEqual(back.parts[i].mode, p.mode, `${r.name} part ${i + 1} mode`);
    assert.strictEqual(back.parts[i].bars, p.bars, `${r.name} part ${i + 1} length`);
  });
  // the drum sounds come back from the channels' samples
  for (const lane of new Set(r.parts.flatMap((p) => p.part.map((n) => n.lane)).filter((l) => DRUM_LANES.includes(l)))) assert.strictEqual(back.drumSamples[lane], samples[lane]);
}

// swing written IN Hackbeat (a row split in 3) reads exactly, no manifest swing needed
{
  const proj = projectFromRound({ parts: [{ part: [{ lane: "hat", beat: 0 }] }] }, { samples });
  proj.patterns[0].data[5][0] = { split: 3, subs: [null, { note: 60, inst: 0, vol: null }, null] };   // row 5 + 1/3 = beat 0.6667
  const r = roundFromProject(proj);
  assert.ok(r.parts[0].part.some((n) => n.lane === "hat" && Math.abs(n.beat - 2 / 3) < 1e-4), "split-cell swing");
}

// volume column -> velocity; other channels -> music, not drums
{
  const proj = projectFromRound({ parts: [{ part: [{ lane: "snare", beat: 1, vel: 0.5 }] }] }, { samples });
  proj.patterns[0].data[0][6] = { note: 67, inst: 0, vol: null };   // "melody" channel
  const r = roundFromProject(proj);
  assert.strictEqual(r.parts[0].part[0].vel, 0.5);
  assert.deepStrictEqual(r.parts[0].music, [{ ch: 6, beat: 0, note: 67, inst: 0, vel: 1 }]);
}

// drums are matched by channel NAME, any order, any case
{
  const proj = projectFromRound({ parts: [{ part: [{ lane: "kick", beat: 0 }] }] }, { samples });
  proj.channels[3].name = "  KICK ";
  assert.strictEqual(roundFromProject(proj).parts[0].part[0].lane, "kick");
}

assert.deepStrictEqual(cellEvents(null), []);
console.log("hackbeat ok");
