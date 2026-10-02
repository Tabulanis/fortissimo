import assert from "node:assert";
import { ROUNDS } from "../src/game/stages.js";
import { roundFromProject, projectFromRound, cellEvents, DRUM_LANES } from "../src/game/hackbeat.js";
import { instrumentNotes, BASS_OCTAVE, TREBLE_OCTAVE } from "../src/game/scales.js";

const samples = Object.fromEntries(DRUM_LANES.map((l) => [l, `garden/${l.replace(" ", "_")}.wav`]));
const key = (n) => `${n.lane}@${n.beat.toFixed(4)}`;
// placeholder melody samples are recorded at C2 (bass) and C5 (treble): Hackbeat note 60 = that pitch
const melodyFor = (r) => ({
  bass: { path: "garden/bass_bars.wav", notes: instrumentNotes({ key: r.key, scale: r.scale, octave: BASS_OCTAVE }).map((m) => 60 + m - 36) },
  treble: { path: "garden/treble_bars.wav", notes: instrumentNotes({ key: r.key, scale: r.scale, octave: TREBLE_OCTAVE }).map((m) => 60 + m - 72) },
});

// every built-in round survives a trip into a Hackbeat project (row layout) and back
for (const r of ROUNDS) {
  const swing = r.swing ? 2 / 3 : 0;
  const melody = melodyFor(r);
  const proj = projectFromRound({ ...r, swing }, { samples, melody });
  assert.strictEqual(proj.kind, "tracker");
  assert.strictEqual(proj.patterns.length, r.parts.length);
  assert.deepStrictEqual(proj.channels.map((c) => c.name).slice(0, 10),
    [...DRUM_LANES, "bass bottom", "bass top", "treble bottom", "treble top"]);
  assert.ok(proj.patterns.every((p) => p.data.length === p.rows && p.data.every((row) => row.length === proj.channels.length)));
  const back = roundFromProject(JSON.parse(JSON.stringify(proj)), { swing });
  assert.deepStrictEqual(back.warnings, [], `${r.name}: no warnings`);
  // what you HEAR must match: drums by lane, bars by row + pitch (a row's bars
  // are the notes it uses, low -> high, so bar NUMBERS may compact)
  const heard = (n, pitchOf) => {
    const [kind, bar] = n.lane.split(" ");
    if (DRUM_LANES.includes(n.lane)) return `${n.lane}@${n.beat.toFixed(4)}`;
    return `${kind} ${+bar <= 4 ? "bottom" : "top"} ${pitchOf(n.lane)}@${n.beat.toFixed(4)}`;
  };
  r.parts.forEach((p, i) => {
    assert.deepStrictEqual(back.parts[i].part.map((n) => heard(n, (l) => back.sounds[l].note)).sort(),
      p.part.map((n) => heard(n, (l) => melody[l.split(" ")[0]].notes[+l.split(" ")[1] - 1])).sort(), `${r.name} part ${i + 1} notes`);
    assert.strictEqual(back.parts[i].mode, p.mode, `${r.name} part ${i + 1} mode`);
    assert.strictEqual(back.parts[i].bars, p.bars, `${r.name} part ${i + 1} length`);
  });
  // sounds: each drum its own sample at its own pitch; every bar used has a sound from its row's sample
  for (const lane of new Set(back.parts.flatMap((p) => p.part.map((n) => n.lane)))) {
    const s = back.sounds[lane];
    assert.ok(s, `${r.name}: ${lane} has a sound`);
    if (DRUM_LANES.includes(lane)) assert.deepStrictEqual(s, { path: samples[lane], note: 60 });
    else assert.strictEqual(s.path, melody[lane.split(" ")[0]].path, `${r.name}: ${lane} uses its row's sample`);
  }
}

// a row's four bars are the four notes written on it, low -> high; a fifth is warned about
{
  const proj = projectFromRound({ parts: [{ part: [{ lane: "hat", beat: 0 }] }] }, { samples, melody: melodyFor(ROUNDS[0]) });
  const ch = proj.channels.findIndex((c) => c.name === "bass top");
  [67, 60, 64, 72, 71].forEach((note, i) => (proj.patterns[0].data[i * 4][ch] = { note, inst: 7, vol: null }));   // slot 07 = the bass sample
  const r = roundFromProject(proj);
  // bass top = bars 5-8: 60 64 67 71 (72 is the fifth note: left out, warned)
  assert.deepStrictEqual(r.parts[0].part.filter((n) => n.lane.startsWith("bass")).map((n) => n.lane), ["bass 7", "bass 5", "bass 6", "bass 8"]);
  assert.deepStrictEqual([5, 6, 7, 8].map((b) => r.sounds[`bass ${b}`].note), [60, 64, 67, 71]);
  assert.strictEqual(r.warnings.length, 2, "one for the fifth note, one for drums+bass in one pattern");
  assert.ok(r.warnings.some((w) => /5 different notes/.test(w)));
}

// swing written IN Hackbeat (a row split in 3) reads exactly, no manifest swing needed
{
  const proj = projectFromRound({ parts: [{ part: [{ lane: "hat", beat: 0 }] }] }, { samples, melody: melodyFor(ROUNDS[0]) });
  proj.patterns[0].data[5][0] = { split: 3, subs: [null, { note: 60, inst: 1, vol: null }, null] };   // row 5 + 1/3 = beat 0.6667
  const r = roundFromProject(proj);
  assert.ok(r.parts[0].part.some((n) => n.lane === "hat" && Math.abs(n.beat - 2 / 3) < 1e-4), "split-cell swing");
}

// volume column -> velocity; channels with other names -> backing music
{
  const proj = projectFromRound({ parts: [{ part: [{ lane: "snare", beat: 1, vel: 0.5 }] }] }, { samples, melody: melodyFor(ROUNDS[0]) });
  const backing = proj.channels.findIndex((c) => c.name === "backing 1");
  proj.patterns[0].data[0][backing] = { note: 67, inst: 1, vol: null };
  const r = roundFromProject(proj);
  assert.strictEqual(r.parts[0].part[0].vel, 0.5);
  assert.deepStrictEqual(r.parts[0].music, [{ ch: backing, beat: 0, note: 67, inst: 1, vel: 1 }]);
}

// channels are matched by NAME, any order, any case
{
  const proj = projectFromRound({ parts: [{ part: [{ lane: "kick", beat: 0 }] }] }, { samples, melody: melodyFor(ROUNDS[0]) });
  proj.channels[3].name = "  KICK ";
  assert.strictEqual(roundFromProject(proj).parts[0].part[0].lane, "kick");
}

assert.deepStrictEqual(cellEvents(null), []);
console.log("hackbeat ok");
