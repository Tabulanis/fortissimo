// Write the game's built-in rounds out as Hackbeat projects in the ROW layout
// (public/rounds/), plus the round manifest — the starting point for rewriting
// them in Hackbeat. After this the FILES are the songs: edit them in Hackbeat.
//   node tools/make-rounds.mjs [--force]   (--force overwrites existing files)
import fs from "node:fs";
import { ROUNDS } from "../src/game/stages.js";
import { projectFromRound, DRUM_LANES } from "../src/game/hackbeat.js";
import { instrumentNotes, BASS_OCTAVE, TREBLE_OCTAVE } from "../src/game/scales.js";
const dir = new URL("../public/rounds/", import.meta.url);
const samples = Object.fromEntries(DRUM_LANES.map((l) => [l, `garden/${l.replace(" ", "_")}.wav`]));
// the placeholder bar samples are recorded at C2 (bass) and C5 (treble): Hackbeat note 60 = that pitch
const melodyFor = (r) => ({
  bass: { path: "garden/bass_bars.wav", notes: instrumentNotes({ key: r.key, scale: r.scale, octave: BASS_OCTAVE }).map((m) => 60 + m - 36) },
  treble: { path: "garden/treble_bars.wav", notes: instrumentNotes({ key: r.key, scale: r.scale, octave: TREBLE_OCTAVE }).map((m) => 60 + m - 72) },
});
const manifest = [];
ROUNDS.forEach((r, i) => {
  const file = `round${i + 1}.json`, swing = r.swing ? 2 / 3 : 0;
  const path = new URL(file, dir);
  if (fs.existsSync(path) && !process.argv.includes("--force")) console.log(`keep ${file} (exists)`);
  else { fs.writeFileSync(path, JSON.stringify(projectFromRound({ ...r, swing }, { samples, melody: melodyFor(r) }), null, 2)); console.log(`wrote ${file}`); }
  // seed Hackbeat's own copy (where you edit it) — never over your edits unless --force
  const hb = new URL(`../../Hackbeat/projects/garden-round${i + 1}.json`, import.meta.url);
  if (fs.existsSync(new URL("../../Hackbeat/projects/", import.meta.url)) && (!fs.existsSync(hb) || process.argv.includes("--force"))) {
    fs.copyFileSync(path, hb); console.log(`  seeded Hackbeat garden-round${i + 1}`);
  }
  manifest.push({ name: r.name, title: r.title, file, swing });
});
fs.writeFileSync(new URL("rounds.json", dir), JSON.stringify(manifest, null, 2));
console.log("wrote rounds.json");
