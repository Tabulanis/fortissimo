/* importsong.js — IMPORT A SONG from a Hackbeat project, inside the game's editor (owner, 2026-10-10: "make an importer in the game
   editor — have IT do the conversions. Hackbeat is a music tool, not a game part").
   A song is three bits, one per round (his design): the project's patterns, in play order, become round 1, 2, 3 of a new level;
   each pattern must carry a drum part, a bass line and a treble line, because the player plays all three in every round. Round 4,
   the Hydra, is the game chaining the three — nothing to import for it.
   Conversion is src/game/hackbeat.js (the tracker's tracks matched by name, pitch and volume as written). The dev server supplies
   the project list and copies the sounds it uses (vite.config.js, /__hackbeat/*); the level is saved exactly as the song-maker
   saves one (POST /__song), so it shows in the level list at once.
     createImporter({ host, log }) -> { refresh() }   host: the panel element to draw into (dev-only) */
import { roundFromProject } from "../game/hackbeat.js";
import { makeLevel, slugOf } from "../game/maker.js";
import { SONG_FORMAT } from "../game/roundfiles.js";

export function createImporter({ host, log = () => {} }) {
  host.innerHTML = `
    <div style="font-weight:700;letter-spacing:.08em;margin-top:10px">IMPORT SONG <span style="font-weight:400;opacity:.6;font-size:11px">a tracker project → a level (3 bits = rounds 1-3)</span></div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 6px;align-items:center;margin-top:5px;font-size:12px">
      <span>Project</span><select data-i="project" style="width:100%;background:#120c08;color:#f1e3cc;border:1px solid #6a4a2a;border-radius:4px;padding:3px"></select>
      <span>Title</span><input data-i="title" placeholder="shown in the level list">
      <span>World</span><select data-i="world" style="background:#120c08;color:#f1e3cc;border:1px solid #6a4a2a;border-radius:4px;padding:3px"><option value="rome">rome</option></select></div>
    <div style="display:flex;gap:4px;margin-top:5px"><button data-i="refresh" style="flex:0 0 auto">↻</button><button data-i="go" style="font-weight:700">Import as level</button></div>
    <div data-i="out" style="font-size:11px;opacity:.75;margin-top:4px;white-space:pre-wrap;max-height:120px;overflow:auto"></div>`;
  const $ = (k) => host.querySelector(`[data-i="${k}"]`), out = $("out");
  const say = (t) => { out.textContent = t; log(t); };
  async function refresh() {
    try { const list = await (await fetch("/__hackbeat/projects")).json(); $("project").innerHTML = list.map((n) => `<option>${n}</option>`).join("") || "<option value=''>(no projects found)</option>"; }
    catch (e) { say("Couldn't list projects: " + e); }
  }
  $("refresh").addEventListener("click", (e) => { e.stopPropagation(); refresh(); });
  $("project").addEventListener("change", () => { if (!$("title").value) $("title").value = $("project").value; });
  $("go").addEventListener("click", async (e) => {
    e.stopPropagation();
    const name = $("project").value, title = ($("title").value || name).trim(), world = $("world").value;
    if (!name) return say("Pick a project.");
    try {
      say("Reading " + name + "…");
      const project = await (await fetch("/__hackbeat/project?name=" + encodeURIComponent(name))).json();
      const order = (project.order && project.order.length ? project.order : project.patterns.map((_, i) => i)).filter((i) => project.patterns[i]);
      if (order.length < 3) return say(`This project has ${order.length} pattern(s) in its play order — a level needs three (rounds 1, 2, 3).`);
      const songs = [], warnings = [], paths = new Set();
      if (order.length > 3) warnings.push(`${order.length} patterns in play order: the first three became the rounds, the other ${order.length - 3} left out`);
      order.slice(0, 3).forEach((pi, i) => {
        const r = roundFromProject({ ...project, order: [pi] }, { name: `Round ${i + 1}`, title });   // ONE pattern = one round
        warnings.push(...r.warnings.map((w) => `round ${i + 1}: ${w}`));
        const { warnings: _w, ...song } = r;
        for (const s of Object.values(song.sounds)) if (s && s.path) paths.add(s.path);
        for (const list of Object.values(song.back || {})) for (const b of list) if (b.path) paths.add(b.path);
        const missing = ["kick", "bass", "treble"].filter((k) => !song.notes.some((n) => k === "kick" ? ["kick", "snare", "hat", "crash", "tom low", "tom high"].includes(n.lane) : n.lane.startsWith(k + " ")));
        if (missing.length) warnings.push(`round ${i + 1} has no ${missing.map((m) => (m === "kick" ? "drum" : m)).join(" / ")} notes — that section will be empty`);
        songs.push({ format: SONG_FORMAT, version: 1, world, swing: 0, ...song });
      });
      say(`Copying ${paths.size} sound(s)…`);
      const cp = await (await fetch("/__hackbeat/samples", { method: "POST", body: JSON.stringify({ paths: [...paths] }) })).json();
      if (cp.missing && cp.missing.length) warnings.push("sounds not found in the tracker's samples folder: " + cp.missing.join(", "));
      const slug = slugOf(title) || "song", files = songs.map((_, i) => `${slug}-${i + 1}.json`);
      const level = makeLevel(songs, { name: title, title, files });
      const r = await fetch("/__song", { method: "POST", body: JSON.stringify({ slug, level, songs }) });
      if (!r.ok) throw new Error(await r.text());
      const notes = songs.map((s) => s.notes.length).join(" / ");
      say(`Imported "${title}" as level "${slug}" — notes per round ${notes}; sounds copied ${cp.copied.length}, ogg ${cp.ogg ? cp.ogg.length : 0}.` + (warnings.length ? "\n" + warnings.join("\n") : "") + "\nReload to see it in the level list.");
    } catch (err) { say("Import failed: " + (err && err.message || err)); }
  });
  refresh();
  return { refresh };
}
