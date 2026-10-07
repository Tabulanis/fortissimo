/* roundfiles.js — the game's songs are its OWN files (owner, 2026-10-07: "remove all dependence on
 * Hackbeat"): public/songs/songs.json lists them in play order ({ name, title, file }); each file is
 * a Fortissimo song — { format: "fortissimo-song", version: 1, name, title, bpm, bars, notes,
 * sounds, back, tracks, fxBus, masterVol } — exactly the round object the game plays, no
 * translation on load. The three original rounds were converted ONCE from their Hackbeat projects
 * once (the importer is in git history, before commit "off Hackbeat step 3"); songs written in the
 * game's own song-maker are saved in the same format. */
export const SONG_FORMAT = "fortissimo-song";

export async function loadRoundFiles(base = "/songs/") {
  const get = async (f) => {
    const r = await fetch(base + f, { cache: "no-store" });
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
    return r.json();
  };
  const list = await get("songs.json");
  const songs = [];
  for (const m of list) {
    const s = await get(m.file);
    if (s.format !== SONG_FORMAT) throw new Error(`${m.file}: not a Fortissimo song (format ${s.format})`);
    const { format, version, ...song } = s;   // song.world says which world it belongs to (rome, …)
    songs.push({ ...song, warnings: [] });
  }
  return songs;
}
