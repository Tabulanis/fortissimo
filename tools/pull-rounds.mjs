// Snapshot the rounds you wrote in Hackbeat into the game (public/rounds), with
// every sample they use, so the repo holds them and a build ships them.
//   node tools/pull-rounds.mjs            (Hackbeat at ../Hackbeat, or HACKBEAT_DIR)
// While developing you don't need this: the dev server reads Hackbeat's copies.
import fs from "node:fs";
import path from "node:path";
import { roundFromProject } from "../src/game/hackbeat.js";

const HACKBEAT = path.resolve(process.env.HACKBEAT_DIR || "../Hackbeat");
const OUT = path.resolve("public/rounds");
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "rounds.json"), "utf8"));
let copied = 0;
for (const m of manifest) {
  const n = m.file.match(/^round(\d+)\.json$/)?.[1];
  const src = n && path.join(HACKBEAT, "projects", `${m.project || `garden-round${n}`}.json`);   // "project": the Hackbeat project it plays
  if (!src || !fs.existsSync(src)) { console.log(`${m.name}: no Hackbeat copy (keeping ${m.file})`); continue; }
  const project = JSON.parse(fs.readFileSync(src, "utf8"));
  // the game loads the sample files themselves; the copies embedded in the project would only be dead weight
  const { sampleData, ...lean } = project;
  fs.writeFileSync(path.join(OUT, m.file), JSON.stringify(lean, null, 2));
  const round = roundFromProject(project, m);
  for (const w of round.warnings) console.log(`  ! ${m.name}: ${w}`);
  // every sample the round's drums, bars and back tracks use
  for (const p of new Set([...Object.values(round.sounds).map((s) => s.path), ...Object.values(round.back).flat().map((e) => e.path)])) {
    const from = path.resolve(HACKBEAT, "samples", p), to = path.resolve(OUT, "samples", p);
    if (!from.startsWith(path.resolve(HACKBEAT, "samples") + path.sep) || !fs.existsSync(from)) { console.log(`  ! missing sample ${p}`); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to); copied++;
    // NSynth (CC BY 4.0) sounds need a credit when the game ships (Hackbeat/LIBRARY-CREDITS.md)
    if (/nsynth/i.test(p)) console.log(`  ! ${p} is from NSynth: ship the credit "Contains sounds from the NSynth dataset by Google Magenta, CC BY 4.0"`);
  }
  console.log(`${m.name}: pulled ${m.file} (${round.bars} bar song, ${round.notes.length} notes)`);
}
console.log(`${copied} sample file(s) copied`);
