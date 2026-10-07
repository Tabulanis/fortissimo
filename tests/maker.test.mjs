// The song-maker's core (src/game/maker.js): timing help, takes, moods, the song it writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HELP, tidyBeat, Draft, barMidi, starterBeat, draftToSong, MOODS, PARTS, starterPart, recordLanes, missingParts, makeLevel, slugOf, thinParts } from "../src/game/maker.js";

test("timing help: off keeps the feel, little pulls halfway to the eighth, tidy snaps to sixteenths, robot to eighths", () => {
  assert.equal(tidyBeat(1.07, "off"), 1.07);
  assert.equal(tidyBeat(1.2, "little"), 1.1);       // nearest eighth is 1.0, pulled halfway
  assert.equal(tidyBeat(1.2, "tidy"), 1.25);
  assert.equal(tidyBeat(1.2, "robot"), 1.0);
});
test("a note played a hair before the loop's end lands on beat 0, not 16", () => {
  assert.equal(tidyBeat(15.97, "tidy", 16), 0);
});
test("takes layer; undo drops only the last; a sloppy player comes out on the grid", () => {
  const d = new Draft();
  d.beginTake("drums"); d.play("kick", 0.06); d.play("kick", 1.97); d.closeTake();
  d.beginTake("drums"); d.play("snare", 1.04); d.closeTake();
  assert.deepEqual(d.notes("drums").map((n) => [n.lane, n.beat]), [["kick", 0], ["snare", 1], ["kick", 2]]);
  d.undo("drums");
  assert.deepEqual(d.notes("drums").map((n) => n.lane), ["kick", "kick"]);
});
test("turning the help up afterwards re-tidies what was already played", () => {
  const d = new Draft({ help: "off" });
  d.beginTake("bass"); d.play("bass 3", 2.12); d.closeTake();
  assert.equal(d.notes("bass")[0].beat, 2.12);
  d.setHelp("robot");
  assert.equal(d.notes("bass")[0].beat, 2);
});
test("two hits snapped onto the same lane and step merge (the louder wins)", () => {
  const d = new Draft();
  d.beginTake("drums"); d.play("hat", 3.98, 0.4); d.play("hat", 4.02, 0.9); d.closeTake();
  const hats = d.notes("drums").filter((n) => n.lane === "hat");
  assert.equal(hats.length, 1); assert.equal(hats[0].vel, 0.9);
});
test("bars only ever hold notes of the mood: row 1 is the octave from the root, row 2 the one above", () => {
  for (const [m, M] of Object.entries(MOODS)) {
    assert.equal(barMidi(1, m, 48), 48); assert.equal(barMidi(8, m, 48), 60); assert.equal(barMidi(9, m, 48), 60);
    for (let b = 1; b <= 8; b++) assert.equal(barMidi(b, m, 48) - 48, M.steps[b - 1]);
  }
});
test("the starter beat: kick on 1 and 3, snare on 2 and 4, hat on the eighths", () => {
  const n = starterBeat(1);
  assert.deepEqual(n.filter((x) => x.lane === "kick").map((x) => x.played), [0, 2]);
  assert.deepEqual(n.filter((x) => x.lane === "snare").map((x) => x.played), [1, 3]);
  assert.equal(n.filter((x) => x.lane === "hat").length, 8);
});
test("the draft becomes a Fortissimo song with the chosen kit and sets, pitched to the mood", () => {
  const banks = JSON.parse(fs.readFileSync("public/banks/rome.json", "utf8"));
  const d = new Draft({ kit: "legion", bass: "cello-pizz", treble: "folk-harp", mood: "dark", tempo: "slow" });
  d.beginTake("drums"); for (const n of starterBeat()) d.play(n.lane, n.played, n.vel); d.closeTake();
  d.beginTake("bass"); d.play("bass 1", 0); d.play("bass 3", 2); d.closeTake();
  const s = draftToSong(d, { name: "Mine", title: "Mine", banks });
  assert.equal(s.format, "fortissimo-song"); assert.equal(s.world, "rome"); assert.equal(s.bpm, 72); assert.equal(s.bars, 4);
  assert.equal(s.sounds.kick.path, banks.drums.find((k) => k.id === "legion").sounds.kick);
  const cello = banks.bass.find((b) => b.id === "cello-pizz");
  assert.equal(s.sounds["bass 1"].path, cello.sample);
  assert.equal(s.sounds["bass 3"].note, 60 + (48 + 3) - cello.root);   // dark: bar 3 = a minor third up
  assert.equal(s.notes.filter((n) => n.lane.startsWith("bass")).length, 2);
  for (const n of s.notes) assert.ok(s.sounds[n.lane], `sound for ${n.lane}`);
});
test("starters exist for every part; treble's stays on bars 1-8 (the top row is the crystals)", () => {
  for (const p of PARTS) assert.ok(starterPart(p).length > 0, p);
  assert.ok(starterPart("treble").every((n) => +n.lane.split(" ")[1] <= 8));
  assert.ok(starterPart("bass").every((n) => recordLanes("bass").includes(n.lane)));
});
test("every lane has its own track, so no note cuts another off", () => {
  const banks = JSON.parse(fs.readFileSync("public/banks/rome.json", "utf8"));
  const s = draftToSong(new Draft(), { name: "x", title: "x", banks });
  const tracks = Object.values(s.sounds).map((x) => x.track);
  assert.equal(new Set(tracks).size, tracks.length);
});
test("playback leaves out the pass being played; a round needs all three parts; a level is 3 rounds", () => {
  const d = new Draft();
  d.beginTake("drums"); d.play("kick", 0);
  assert.equal(d.notes("drums", { closedOnly: true }).length, 0);
  assert.equal(d.notes("drums").length, 1);
  d.closeTake();
  assert.deepEqual(missingParts(d), ["bass", "treble"]);
  const songs = [1, 2, 3].map(() => ({ world: "rome", bpm: 92, bars: 4 }));
  const L = makeLevel(songs, { name: "Mine", title: "Mine", files: ["a", "b", "c"] });
  assert.equal(L.format, "fortissimo-level"); assert.deepEqual(L.hydra.from, [1, 2, 3]);
  assert.throws(() => makeLevel(songs.slice(0, 2), { name: "x", title: "x", files: ["a", "b"] }));
  assert.equal(slugOf("My Big Song!"), "my-big-song");
});
test("a part under 16 notes is flagged thin (empty ones are 'missing', not thin)", () => {
  const d = new Draft();
  d.beginTake("bass"); for (let b = 0; b < 8; b++) d.play("bass 1", b); d.closeTake();
  for (const n of starterPart("drums")) { d.beginTake("drums"); d.play(n.lane, n.played, n.vel); d.closeTake(); }
  assert.deepEqual(thinParts(d), ["bass"]);
});
