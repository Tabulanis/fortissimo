// Write each built-in round as ONE FULL SONG in Hackbeat (owner's layout): one
// track per sample — Bass drum, snare, hihat, crash, Bass/Treble instrument
// top/bottom — plus the blank DRUM / BASS / TREBLE BACK tracks; all playing
// together. The game splits the song into teaching steps by difficulty.
//   node tools/make-song-files.mjs     -> Hackbeat/projects/garden-roundN.json
// CAREFUL: overwrites those files. To add the back tracks to songs you've
// edited, use tools/add-back-tracks.mjs instead.
import fs from "node:fs";
import { ROUNDS } from "../src/game/stages.js";
import { songProjectFromRound } from "../src/game/hackbeat.js";
ROUNDS.forEach((r, i) => {
  const { project, dropped } = songProjectFromRound(r);
  fs.writeFileSync(new URL(`../../Hackbeat/projects/garden-round${i + 1}.json`, import.meta.url), JSON.stringify(project, null, 2));
  console.log(`garden-round${i + 1}: ${project.patterns[0].rows / 32} bar(s)${dropped ? `, ${dropped} tom notes left out` : ""}`);
});
