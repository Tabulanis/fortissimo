/* roundfiles.js — the game's songs come from Hackbeat projects.
 *
 * /rounds/rounds.json lists the rounds ({name, title, file, swing}); each file
 * is a Hackbeat project (row layout, see hackbeat.js). In development the dev
 * server hands out the copies Hackbeat is editing (save in Hackbeat, reload the
 * game); `node tools/pull-rounds.mjs` snapshots them into public/rounds. */
import { roundFromProject } from "./hackbeat.js";

export async function loadRoundFiles(base = "/rounds/") {
  const get = async (f) => {
    const r = await fetch(base + f, { cache: "no-store" });
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
    return r.json();
  };
  const manifest = await get("rounds.json");
  const rounds = [];
  for (const m of manifest) {
    const round = roundFromProject(await get(m.file), m);
    for (const w of round.warnings) console.warn(`${m.name}: ${w}`);
    rounds.push(round);
  }
  return rounds;
}
