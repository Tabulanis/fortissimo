// Copy Hackbeat's shared audio code into the game, word for word, so a round
// sounds the same here as it does in Hackbeat:
//   voices.js   the voice engine (envelopes, stealing)
//   hbchain.js  a track's effect chain (EQ, pan, drive, crush, chorus, sends)
//   node tools/sync-hackbeat-audio.mjs     (Hackbeat at ../Hackbeat, or HACKBEAT_DIR)
// tests/hbsync.test.mjs fails when the copies have drifted.
import fs from "node:fs";
import path from "node:path";

const HACKBEAT = path.resolve(process.env.HACKBEAT_DIR || "../Hackbeat");
for (const f of ["voices.js", "hbchain.js"]) {
  fs.copyFileSync(path.join(HACKBEAT, "static", f), path.resolve("src/audio", f));
  console.log("synced", f);
}
