// END-TO-END part 1 (2026-10-07): a scripted LOOSE player writes a song through the song-maker core
// (src/game/maker.js) — every hit up to ±0.12 beat off — the "Tidy" help puts it on the grid, and
// the draft is saved as a real song file, added to public/songs as the last level ("Made test").
//   node tests/harness/make-test-song.mjs        (adds it)    --remove   (takes it out again)
import fs from "node:fs";
import { Draft, starterBeat, draftToSong } from "../../src/game/maker.js";
const LIST = "public/songs/songs.json", FILE = "song-made-test.json";
const list = JSON.parse(fs.readFileSync(LIST, "utf8")).filter((s) => s.file !== FILE);
if (process.argv.includes("--remove")) { fs.writeFileSync(LIST, JSON.stringify(list, null, 1) + "\n"); fs.rmSync("public/songs/" + FILE, { force: true }); console.log("removed"); process.exit(0); }
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const sloppy = (b) => b + (rnd() - 0.5) * 0.24;   // up to ±0.12 beat off
const banks = JSON.parse(fs.readFileSync("public/banks/rome.json", "utf8"));
const d = new Draft({ kit: "legion", bass: "cello-pizz", treble: "folk-harp", mood: "heroic", tempo: "medium", help: "tidy" });
d.beginTake("drums"); for (const n of starterBeat()) d.play(n.lane, sloppy(n.played), n.vel); d.closeTake();
d.beginTake("drums"); for (const b of [3.5, 7.5, 11.5, 15.5]) d.play("tom low", sloppy(b), 0.8); d.play("crash", sloppy(0), 1); d.closeTake();
d.beginTake("bass"); [1, 1, 5, 4, 1, 1, 6, 5].forEach((bar, i) => d.play(`bass ${bar}`, sloppy(i * 2), 0.9)); d.closeTake();
d.beginTake("treble"); [5, 6, 8, 6, 5, 3, 2, 1, 3, 5, 6, 5].forEach((bar, i) => d.play(`treble ${bar}`, sloppy(i * 1.25), 0.8)); d.closeTake();
const song = draftToSong(d, { name: "Made test", title: "Made test (song-maker)", banks });
const off = d.takes.drums.flat().filter((n) => Math.abs(n.played - Math.round(n.played * 4) / 4) > 1e-6).length;
fs.writeFileSync("public/songs/" + FILE, JSON.stringify(song));
list.push({ name: song.name, title: song.title, file: FILE });
fs.writeFileSync(LIST, JSON.stringify(list, null, 1) + "\n");
console.log(`written: ${song.notes.length} notes (drums ${d.notes("drums").length}, bass ${d.notes("bass").length}, treble ${d.notes("treble").length}); ${off} drum hits were played off the grid, all tidied: ${song.notes.every((n) => Math.abs(n.beat * 4 - Math.round(n.beat * 4)) < 1e-6)}; it is level ${list.length} of ${list.length}`);
