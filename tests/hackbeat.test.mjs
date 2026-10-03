import assert from "node:assert";
import { ROUNDS } from "../src/game/stages.js";
import { roundFromProject, songProjectFromRound, trackRole, cellEvents, DRUM_LANES, SONG_TRACKS } from "../src/game/hackbeat.js";

// the owner's track names are recognised (any case / spacing), and the back tracks
assert.deepStrictEqual(trackRole("Bass drum"), { drum: "kick" });
assert.deepStrictEqual(trackRole("  HIHAT "), { drum: "hat" });
assert.deepStrictEqual(trackRole("Bass instrument top"), { kind: "bass", row: 1 });
assert.deepStrictEqual(trackRole("treble instrument bottom"), { kind: "treble", row: 0 });
assert.deepStrictEqual(trackRole("DRUM BACK"), { back: "drums" });
assert.deepStrictEqual(trackRole("BASS BACK"), { back: "bass" });
assert.strictEqual(trackRole("tambourine"), null);

// every built-in round -> one full-song file -> back: the same notes (toms aside: not in the owner's list)
for (const r of ROUNDS) {
  const { project } = songProjectFromRound(r);
  assert.strictEqual(project.patterns.length, 1, "one full song");
  assert.deepStrictEqual(project.channels.map((c) => c.name),
    ["Bass drum", "snare", "hihat", "crash", "Bass instrument top", "Bass instrument bottom", "Treble instrument top", "Treble instrument bottom", "DRUM BACK", "BASS BACK", "TREBLE BACK"]);
  const song = roundFromProject(JSON.parse(JSON.stringify(project)), { name: r.name });
  assert.deepStrictEqual(song.warnings, [], `${r.name}: no warnings`);
  const bars = Math.max(...r.parts.map((p) => p.bars || 1));
  assert.strictEqual(song.bars, bars, `${r.name}: song length`);
  // expected: every part repeated to the song length, toms left out
  const want = [];
  for (const p of r.parts) for (const n of p.part) {
    if (n.lane.startsWith("tom")) continue;
    for (let k = 0; k < bars / (p.bars || 1); k++) want.push({ ...n, beat: n.beat + k * 4 * (p.bars || 1) });
  }
  const drumsOf = (list) => list.filter((n) => DRUM_LANES.includes(n.lane)).map((n) => `${n.lane}@${n.beat.toFixed(4)}`).sort();
  assert.deepStrictEqual(drumsOf(song.notes), drumsOf(want), `${r.name}: drums`);
  for (const kind of ["bass", "treble"]) {
    const at = (list) => list.filter((n) => n.lane.startsWith(kind)).map((n) => n.beat.toFixed(4)).sort();
    assert.deepStrictEqual(at(song.notes), at(want), `${r.name}: ${kind} notes at the same times`);
  }
  for (const n of song.notes) assert.ok(song.sounds[n.lane], `${r.name}: ${n.lane} has a sound`);
  assert.deepStrictEqual(song.sounds.kick, { path: "garden/kick.wav", note: 60, track: 0, voice: null });
  assert.deepStrictEqual(song.back, { drums: [], bass: [], treble: [] }, "blank back tracks");
}

// inst counts from 1: a note on slot 2 uses the 2nd instrument
{
  const { project } = songProjectFromRound(ROUNDS[0]);
  project.instruments[1].path = "mine/snare2.wav";
  assert.strictEqual(roundFromProject(project).sounds.snare.path, "mine/snare2.wav");
}

// Hackbeat's per-slot Pitch + Tune move the sound (the bar stays the same note name)
{
  const { project } = songProjectFromRound(ROUNDS[0]);
  project.instruments[0].transpose = -2; project.instruments[0].tune = 25;
  assert.strictEqual(roundFromProject(project).sounds.kick.note, 60 - 2 + 0.25);
}

// rows: four note NAMES, low -> high; octaves fold; a fifth name is warned about
{
  const { project } = songProjectFromRound({ parts: [{ part: [{ lane: "hat", beat: 0 }] }] });
  const top = project.channels.findIndex((c) => c.name === "Bass instrument top");
  [67, 60, 64, 69, 71, 72].forEach((note, i) => (project.patterns[0].data[i * 4][top] = { note, inst: 5, vol: null }));
  const s = roundFromProject(project);
  // G C E A B C' -> names C E G A (B left out; the high C folds onto C)
  assert.deepStrictEqual(s.notes.filter((n) => n.lane.startsWith("bass")).map((n) => n.lane), ["bass 7", "bass 5", "bass 6", "bass 8", "bass 5"]);
  assert.deepStrictEqual([5, 6, 7, 8].map((b) => s.sounds[`bass ${b}`].note), [60, 64, 67, 69]);
  assert.ok(s.warnings.some((w) => /5 different notes/.test(w)));
}

// back tracks: their notes and samples, per section
{
  const { project } = songProjectFromRound({ parts: [{ part: [{ lane: "hat", beat: 0 }] }] });
  project.instruments.push({ path: "amb/wind.wav", name: "wind" });
  const db = project.channels.findIndex((c) => c.name === "DRUM BACK");
  project.patterns[0].data[0][db] = { note: 60, inst: project.instruments.length, vol: 32 };
  const s = roundFromProject(project);
  assert.deepStrictEqual(s.back.drums, [{ beat: 0, note: 60, path: "amb/wind.wav", vel: 0.5, track: db, voice: null }]);
  assert.ok(!s.notes.some((n) => n.lane === "DRUM BACK"), "back music is not something you play");
}

// the song is the patterns in ORDER, end to end
{
  const { project } = songProjectFromRound({ parts: [{ part: [{ lane: "kick", beat: 0 }] }] });
  project.patterns.push(JSON.parse(JSON.stringify(project.patterns[0])));
  project.order = [0, 1];
  const s = roundFromProject(project);
  assert.strictEqual(s.bars, 2);
  assert.deepStrictEqual(s.notes.filter((n) => n.lane === "kick").map((n) => n.beat), [0, 4]);
}

// swing written IN Hackbeat (a row split in 3) reads exactly
{
  const { project } = songProjectFromRound({ parts: [{ part: [{ lane: "hat", beat: 0 }] }] });
  const hh = SONG_TRACKS.findIndex((t) => t.lane === "hat");
  project.patterns[0].data[5][hh] = { split: 3, subs: [null, { note: 60, inst: hh + 1, vol: null }, null] };
  assert.ok(roundFromProject(project).notes.some((n) => n.lane === "hat" && Math.abs(n.beat - 2 / 3) < 1e-4));
}

// an unknown track is ignored, with a warning
{
  const { project } = songProjectFromRound({ parts: [{ part: [{ lane: "hat", beat: 0 }] }] });
  project.channels.push({ name: "tambourine", fx: {} });
  project.patterns[0].data.forEach((row) => row.push(null));
  assert.ok(roundFromProject(project).warnings.some((w) => /tambourine/.test(w)));
}

// track effects, the slot's voice and the track nudge come through to the game
{
  const { project } = songProjectFromRound(ROUNDS[0]);
  project.channels[1].fx.dist = { on: true, drive: 0.7 };
  project.channels[1].fx.vol = 0.5;
  project.channels[0].fx.nudge = 250;   // ms; at 120 bpm = half a beat later
  project.bpm = 120;
  project.fxBus = { reverbDecay: 4 };
  project.instruments[1].voice = { attack: 0.2, release: 1 };
  const s = roundFromProject(project);
  assert.deepStrictEqual(s.tracks[1].fx.dist, { on: true, drive: 0.7 });
  assert.strictEqual(s.tracks[1].fx.vol, 0.5);
  assert.strictEqual(s.sounds.snare.track, 1);
  assert.deepStrictEqual(s.sounds.snare.voice, { attack: 0.2, release: 1 }, "the slot's voice comes along");
  assert.strictEqual(s.fxBus.reverbDecay, 4);
  assert.strictEqual(s.fxBus.delayTime, 0.3);
  assert.ok(s.notes.some((n) => n.lane === "kick" && n.beat === 0.5), "kick nudged half a beat");
}

assert.deepStrictEqual(cellEvents(null), []);
// a note dragged a little off the grid in Hackbeat keeps its exact time
assert.deepStrictEqual(cellEvents({ note: 60, inst: 1, vol: null, off: 0.25 }), [{ frac: 0.25, note: 60, inst: 1, vol: null }]);
console.log("hackbeat ok");
