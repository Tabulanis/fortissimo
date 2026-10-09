/* save.js — THE PLAYER'S SAVE as one thing (10-09, "make it professional": progress that survives updates, a reset, a copy).
   The game keeps its state in a handful of browser keys (gr.settings, gr.unlocked, gr.level, gr.run2, gr.calib, gr.autoTier…);
   those stay as they are — this layer puts a VERSION on them, migrates old saves forward on first run after an update,
   and gives Options the three things a player expects: reset progress, copy the save, copy the log.
   In the packaged app the WebView's storage persists across updates of the same app id (Capacitor keeps it).
     SAVE_VERSION, migrate(), exportSave() -> JSON string, importSave(json), resetProgress(), resetAll() */
export const SAVE_VERSION = 1;
const VERSION_KEY = "gr.saveVersion";
const PROGRESS = ["gr.unlocked", "gr.level", "gr.run2", "gr.hydra"];              // what "reset progress" clears
const KEEP_ON_RESET = ["gr.settings", "gr.calib", "gr.autoTier", "gr.saveVersion"];   // the device's own settings stay

const keys = () => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("gr.")) out.push(k); } } catch { /* storage blocked */ } return out; };

/** run once at boot: an older save is brought up to date (nothing to do yet at v1 — the hook is here so v2 has somewhere to go) */
export function migrate() {
  let v = 0; try { v = +localStorage.getItem(VERSION_KEY) || 0; } catch { return; }
  if (v === SAVE_VERSION) return;
  // v0 → v1: the loose keys as they were; just stamp it
  try { localStorage.setItem(VERSION_KEY, String(SAVE_VERSION)); } catch { /* fine */ }
}
export function exportSave() {
  const data = {}; for (const k of keys()) { try { data[k] = localStorage.getItem(k); } catch { /* skip */ } }
  return JSON.stringify({ game: "fortissimo", saveVersion: SAVE_VERSION, exported: new Date().toISOString(), data }, null, 1);
}
export function importSave(json) {
  const j = JSON.parse(json);
  if (!j || j.game !== "fortissimo" || !j.data) throw new Error("not a Fortissimo save");
  for (const [k, v] of Object.entries(j.data)) if (k.startsWith("gr.") && typeof v === "string") localStorage.setItem(k, v);
  migrate();
}
export function resetProgress() { for (const k of PROGRESS) { try { localStorage.removeItem(k); } catch { /* fine */ } } }
export function resetAll() { for (const k of keys()) if (!KEEP_ON_RESET.includes(k) || k !== VERSION_KEY) { try { localStorage.removeItem(k); } catch { /* fine */ } } }
