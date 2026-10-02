// Add the three BACKGROUND tracks — DRUM BACK, BASS BACK, TREBLE BACK — to the
// Hackbeat round files, NON-DESTRUCTIVELY: empty channels appended at the end,
// every existing note, sample and setting left exactly as it is. Safe to run on
// songs you've edited; does nothing to a file that already has them.
//   node tools/add-back-tracks.mjs
import fs from "node:fs";
import path from "node:path";
const DIR = path.resolve(process.env.HACKBEAT_DIR || "../Hackbeat", "projects");
const BACK = ["DRUM BACK", "BASS BACK", "TREBLE BACK"];
const fx = () => ({ nudge: 0, vol: 0.85, pan: 0, eq: { low: 0, mid: 0, high: 0 }, dist: { on: false, drive: 0.4 },
  crush: { on: false, bits: 8 }, chorus: { on: false, rate: 1.5, depth: 0.01, mix: 0.5 }, delay: { on: false, send: 0.3 },
  reverb: { on: false, send: 0.3 }, filter: { on: false, type: "lowpass", freq: 2000, q: 1 } });
for (const f of fs.readdirSync(DIR).filter((f) => /^garden-round\d+\.json$/.test(f)).sort()) {
  const file = path.join(DIR, f), song = JSON.parse(fs.readFileSync(file, "utf8"));
  const have = new Set(song.channels.map((c) => String(c.name).trim().toUpperCase()));
  const add = BACK.filter((n) => !have.has(n));
  if (!add.length) { console.log(`${f}: already has the back tracks`); continue; }
  for (const name of add) song.channels.push({ name, mute: false, solo: false, fx: fx() });
  for (const pat of song.patterns) for (const row of pat.data) for (let k = 0; k < add.length; k++) row.push(null);
  fs.writeFileSync(file, JSON.stringify(song, null, 2));
  console.log(`${f}: added ${add.join(", ")}`);
}
