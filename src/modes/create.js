/* modes/create.js — the SONG-MAKER's arena (moved out of main.js 2026-10-07: "the engine is getting
   top-heavy"). main.js hands in G: getters/setters onto its own state (ctx, clock, song(), pool, …). */
import { createRecorder } from "../ui/maker-ui.js";
import { bootlog } from "../bootlog.js";

export function createMode(G) {
  // --- CREATE: the song-maker's arena (maker-ui.js draws the panel) -------------------------------
  // The loop runs; what you've recorded plays back each pass (the pass you're playing is heard live);
  // each pass while recording is a take. No army, no chart: mode "free".
  function makeRecorder() {
    document.body.classList.add("mk-creating");   // the life bars and the gear make no sense while writing: the bar sits up there instead
    G.recorder = createRecorder({ picks: G.CREATE, banks: G.BANKS, hooks: {
      setPart: () => { G.applyStage(); G.relabel(); },
      // 🎚 Sound: a part's settings, live — its tracks in the order draftToSong builds them (6 drums, 16 bass, 16 treble)
      setMix: (part, fx) => G.setTrackFx(part === "drums" ? [0, 1, 2, 3, 4, 5] : Array.from({ length: 16 }, (_, i) => (part === "bass" ? 6 : 22) + i), fx),
      settings: () => G.openSettings(),
      leave: () => { location.href = location.pathname; },
      save: async (slug, level, songs) => {
        try { localStorage.setItem(`gr.made.${slug}`, JSON.stringify({ level, songs })); } catch { /* the server copy is the real one */ }
        const r = await fetch("/__song", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, level, songs }) }).catch(() => null);
        bootlog("create saved", { slug, server: !!(r && r.ok), notes: songs.map((x) => x.notes.length) });
        return r && r.ok ? "server" : "device";
      },
      play: async (slug) => {   // straight into round 1 of the new level
        const list = await (await fetch("/songs/songs.json", { cache: "no-store" })).json();
        const i = list.findIndex((m) => m.file === `${slug}-1.json`);
        try { localStorage.setItem("gr.level", Math.max(0, i)); sessionStorage.setItem("gr.autostart", JSON.stringify({ ...G.RUN, lock: G.RUN.lock === Infinity ? "all" : G.RUN.lock })); } catch { /* the menu, then */ }
        location.href = location.pathname;
      },
    } });
    if (window.__gr) window.__gr.recorder = G.recorder;   // harness handle
  }
  function startCreating() {
    G.mode = "free";
    const L = 4 * G.song().bars;
    let until = G.ctx.currentTime;
    setInterval(() => {
      if (!G.clock) return;
      const to = G.ctx.currentTime + 0.12, beatAt = (t) => (t - G.clock.first) / G.clock.beatDur, now = beatAt(G.ctx.currentTime);
      G.recorder.lapTo(Math.floor(now / L), ((now % L) + L) % L);
      const notes = G.recorder.playback(), b0 = beatAt(until), b1 = beatAt(to);
      for (let lap = Math.floor(b0 / L); lap <= Math.floor(b1 / L); lap++) for (const n of notes) {
        const b = lap * L + n.beat, entry = G.KEYMAP_BY_LANE[n.lane];
        if (b < b0 || b >= b1 || b < 0 || !entry) continue;
        const when = G.clock.first + b * G.clock.beatDur;
        G.pool.noteOn({ channel: entry.idx + 40, midi: 60, baseNote: 60, ...G.laneSound(entry.ln), velocity: n.vel * 0.85, when });
        setTimeout(() => G.stage3d.press(entry.idx, "FREE"), Math.max(0, (when - G.ctx.currentTime) * 1000));   // the drum / gun it's on lights up
      }
      until = to;
    }, 25);
    G.hudUI.say("The loop is running — press Record (or Enter) and play", "good", 4000);
  }

  return { makeRecorder, startCreating };
}
