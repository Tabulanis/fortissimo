import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

// the game's copies of Hackbeat's audio code must match Hackbeat's (when it's next door)
const HB = path.resolve(process.env.HACKBEAT_DIR || "../Hackbeat", "static");
if (!fs.existsSync(HB)) console.log("hbsync skipped (no Hackbeat next door)");
else {
  for (const f of ["voices.js", "hbchain.js"]) {
    assert.strictEqual(fs.readFileSync(path.resolve("src/audio", f), "utf8"), fs.readFileSync(path.join(HB, f), "utf8"),
      `src/audio/${f} has drifted from Hackbeat — run: node tools/sync-hackbeat-audio.mjs`);
  }
  console.log("hbsync ok");
}
