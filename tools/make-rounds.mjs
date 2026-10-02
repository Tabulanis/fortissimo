// One-off: write the game's built-in rounds out as Hackbeat projects (public/rounds/),
// plus the round manifest. After this the files are the source: edit them in
// Hackbeat (or the dev editor), not stages.js.   node tools/make-rounds.mjs [--force]
import fs from "node:fs";
import { ROUNDS } from "../src/game/stages.js";
import { projectFromRound, DRUM_LANES } from "../src/game/hackbeat.js";
const dir = new URL("../public/rounds/", import.meta.url);
const samples = Object.fromEntries(DRUM_LANES.map((l) => [l, `garden/${l.replace(" ", "_")}.wav`]));
const manifest = [];
ROUNDS.forEach((r, i) => {
  const file = `round${i + 1}.json`, swing = r.swing ? 2 / 3 : 0;
  const path = new URL(file, dir);
  if (fs.existsSync(path) && !process.argv.includes("--force")) console.log(`keep ${file} (exists)`);
  else { fs.writeFileSync(path, JSON.stringify(projectFromRound({ ...r, swing }, { samples }), null, 2)); console.log(`wrote ${file}`); }
  manifest.push({ name: r.name, title: r.title, file, swing });
});
fs.writeFileSync(new URL("rounds.json", dir), JSON.stringify(manifest, null, 2));
console.log("wrote rounds.json");
