// The cut from Hackbeat (2026-10-07): the game now loads its own song files. This proves each one is
// EXACTLY what the old path (the Hackbeat project through roundFromProject) gave the game — same
// notes, sounds, backing, tracks, effects, tempo, length.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { roundFromProject } from "../src/game/hackbeat.js";

const man = JSON.parse(fs.readFileSync("public/rounds/rounds.json", "utf8"));
const list = JSON.parse(fs.readFileSync("public/songs/songs.json", "utf8"));

test("one song file per original round, in the same order", () => {
  assert.deepEqual(list.map((s) => s.title), man.map((m) => m.title));
});
for (const [i, m] of man.entries()) {
  test(`${m.title}: the song file equals what the Hackbeat path produced`, () => {
    const old = roundFromProject(JSON.parse(fs.readFileSync("public/rounds/" + m.file, "utf8")), m);
    const { format, version, swing, ...now } = JSON.parse(fs.readFileSync("public/songs/" + list[i].file, "utf8"));
    assert.equal(format, "fortissimo-song");
    const { warnings, ...was } = old;
    assert.deepEqual(now, was);
  });
}
