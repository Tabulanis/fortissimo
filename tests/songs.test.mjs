// The game's own songs (off Hackbeat since 2026-10-07; the one-time import proved each file equal
// to the old Hackbeat path — that check and the importer are in git history, commit 87b217b).
// Now: every listed song is a well-formed Fortissimo song whose every note has a sound on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const list = JSON.parse(fs.readFileSync("public/songs/songs.json", "utf8"));
const exists = (p) => fs.existsSync("public/rounds/samples/" + p) || fs.existsSync("public/rounds/samples/" + p.replace(/\.wav$/i, ".ogg"));

test("the three original rounds lead the list, in order", () => {
  assert.deepEqual(list.slice(0, 3).map((s) => s.file), ["song1.json", "song2.json", "song3.json"]);
});
for (const m of list) {
  test(`${m.file}: a Fortissimo song, every note sounds`, () => {
    const s = JSON.parse(fs.readFileSync("public/songs/" + m.file, "utf8"));
    assert.equal(s.format, "fortissimo-song"); assert.ok(s.world); assert.ok(s.bpm > 0 && s.bars > 0);
    assert.ok(s.notes.length > 0);
    for (const n of s.notes) assert.ok(s.sounds[n.lane], `${m.file}: no sound for ${n.lane}`);
    for (const [lane, snd] of Object.entries(s.sounds)) assert.ok(exists(snd.path), `${m.file}: ${lane} -> ${snd.path} missing`);
  });
}
