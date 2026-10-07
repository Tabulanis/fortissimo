#!/usr/bin/env node
/* export-songs.mjs — ONE-TIME cut from Hackbeat (owner, 2026-10-07: "remove all dependence on
   Hackbeat"). Reads the round snapshots (public/rounds/rounds.json + roundN.json, Hackbeat project
   files), converts each ONCE with hackbeat.js roundFromProject, and writes Fortissimo's own song
   files: public/songs/<file>.json ({ format: "fortissimo-song", version: 1, ...the round }) and
   public/songs/songs.json (the list, in play order). The game loads only these from now on;
   hackbeat.js stays only as this importer. Re-run only to re-import a Hackbeat project on purpose.
     node tools/export-songs.mjs */
import fs from "node:fs";
import { roundFromProject } from "../src/game/hackbeat.js";

const man = JSON.parse(fs.readFileSync("public/rounds/rounds.json", "utf8"));
const list = [];
for (const m of man) {
  const round = roundFromProject(JSON.parse(fs.readFileSync("public/rounds/" + m.file, "utf8")), m);
  const file = m.file.replace(/^round/, "song");
  const song = { format: "fortissimo-song", version: 1, world: m.world || "rome", name: m.name, title: m.title, swing: m.swing || 0, ...round };   // every song belongs to a WORLD (BRIEF "WORLDS")
  delete song.warnings;
  fs.writeFileSync("public/songs/" + file, JSON.stringify(song));
  list.push({ name: m.name, title: m.title, file });
  console.log(`${file}: ${m.title} — ${round.notes.length} notes, ${Object.keys(round.sounds).length} sounds, warnings: ${round.warnings.length}`);
}
fs.writeFileSync("public/songs/songs.json", JSON.stringify(list, null, 1) + "\n");
console.log(`songs.json: ${list.length} songs`);
