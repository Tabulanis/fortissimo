/* modes/hydra.js — ROUND 4, THE HYDRA, in the game (moved out of main.js 2026-10-07). The rules are
   game/hydrafight.js; this is the band, the bar lines, the movements and what the player sees.
   main.js hands in G: getters/setters onto its own state. */
import { HydraFight, HEAD_SECTION } from "../game/hydrafight.js";
import { Conductor } from "../game/conductor.js";
import { startClock } from "../audio/clock.js";
import { gradeRound } from "../game/grade.js";
import { scoreMultiplier } from "../game/run.js";
import { bootlog } from "../bootlog.js";
const { VOICE_PRESETS, voiceSettings } = window.HB_VOICES;

export function hydraMode(G) {
  // --- ROUND 4: THE HYDRA ----------------------------------------------------------------------------
  // The band plays the movement's song (round 1's, then 2's, then 3's) — every note, each section at the
  // conductor's level — and the back recordings follow the same levels. The fight (hydrafight.js) runs on
  // bar lines (judged half a beat after each, so a late-but-clean accent still counts) and the gestures.
  let hydraBarBase = 0, hydraLastBar = null, hydraMovement = 0, hydraOffsets = [], hydraFinale = false;
  const metronomeBeat = (time) => G.pool.noteOn({ channel: 0, midi: 72, baseNote: 60, buffer: G.drums.click, velocity: 0.35, when: time, destination: G.mixer.metronome, settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }) });
  const sectionOfLane = (lane) => (lane.startsWith("bass") ? "bass" : lane.startsWith("treble") ? "treble" : "drums");
  const hydraKeys = { drums: "1", bass: "2", treble: "3" };
  function startHydra() {
    G.hydraFight = new HydraFight({ life: 100 });
    G.hudUI.setLife(100, 100);
    G.hudUI.say("THE HYDRA — when a head rears, pick its section (1 drums · 2 bass · 3 treble) and ACCENT (O) on the next bar line", "good", 8000);
    let until = G.ctx.currentTime;
    setInterval(() => {
      if (!G.clock || !G.hydraFight) return;
      const L = 4 * G.song().bars, beatAt = (t) => (t - G.clock.first) / G.clock.beatDur, to = G.ctx.currentTime + 0.12;
      const b0 = beatAt(until), b1 = beatAt(to);
      for (let lap = Math.floor(b0 / L); lap <= Math.floor(b1 / L); lap++) for (const n of G.song().notes) {
        const b = lap * L + n.beat, entry = G.KEYMAP_BY_LANE[n.lane];
        if (b < b0 || b >= b1 || b < 0 || !entry) continue;
        const lv = G.conductor.level(sectionOfLane(n.lane), b);
        if (lv < 0.03) continue;
        G.pool.noteOn({ channel: entry.idx + 40, midi: 60, baseNote: 60, ...G.laneSound(entry.ln, n.midi), velocity: (n.vel ?? 0.9) * lv, when: G.clock.first + b * G.clock.beatDur });
      }
      until = to;
      G.updateBackLevels();
      // the bar lines (half a beat late: a clean accent may land just after the one)
      const local = Math.floor((beatAt(G.ctx.currentTime) - G.conductor.window) / 4);
      if (local >= 0 && local !== hydraLastBar) {
        hydraLastBar = local;
        const on = Object.fromEntries(HEAD_SECTION.map((sec) => [sec, G.conductor.isOn(sec)]));
        hydraEvents(G.hydraFight.bar(hydraBarBase + local, on));
      }
    }, 25);
  }
  function hydraGesture(ev) {
    hydraOffsets.push(ev.kind === "release" ? 0 : ev.error * G.clock.beatDur);
    hydraEvents(G.hydraFight.gesture({ ...ev, bar: hydraBarBase + ev.bar }));
  }
  function hydraEvents(evs) {
    const H = G.stage3d.hydra, now = performance.now() / 1000;
    for (const e of evs) {
      bootlog("hydra", e);
      const sec = e.head != null ? HEAD_SECTION[e.head] : null;
      if (e.type === "rear") { H.rear(e.head, true); G.hudUI.say(`⚠ The ${sec.toUpperCase()} head rears! Press ${hydraKeys[sec]}, then O on the next bar line`, "bad", 2600); }
      else if (e.type === "hit") { H.hit(e.head, now); G.hudUI.say(`💥 Struck the ${sec} head!${e.hp > 0 ? ` (${e.hp} more)` : ""}`, "good", 1800); }
      else if (e.type === "down") { H.down(e.head); G.hudUI.say(`🐉 The ${sec} head is DOWN — keep ${sec} playing or it grows back`, "good", 3200); if (G.hydraFight.movement > hydraMovement) nextMovement(G.hydraFight.movement); }
      else if (e.type === "strike") { H.rear(e.head, false); H.bite(e.head, now); G.hurtFlash(); G.hudUI.setLife(G.hydraFight.life, G.hydraFight.life); G.hudUI.say(e.dome ? `The ${sec} head bit — the full band (the dome) took half` : `The ${sec} head bit! (all three sections playing = the dome halves it)`, "bad", 2200); }
      else if (e.type === "regrow") { H.up(e.head); G.hudUI.say(`The ${sec} head GREW BACK — ${sec} was cut too long`, "bad", 3000); }
      else if (e.type === "won") hydraWon();
      else if (e.type === "lost") hydraLost();
    }
    G.hudUI.setPart(`Round 4 · The Hydra · heads ${3 - G.hydraFight.downCount}/3 · movement ${hydraMovement + 1}`);
  }
  /** the band moves on to round m+1's music, starting exactly on the next bar line, at that song's own tempo */
  function nextMovement(m) {
    hydraMovement = m;
    const nextBarBeat = (Math.floor((G.ctx.currentTime - G.clock.first) / G.clock.beatDur / 4) + 1) * 4, at = G.clock.first + nextBarBeat * G.clock.beatDur;
    setTimeout(() => {
      G.clock.stop();
      hydraBarBase += nextBarBeat / 4; hydraLastBar = null;
      G.roundIdx = G.HYDRA.rounds[m];
      G.BPM = Math.round((G.song().bpm || 80) * G.RUN.tempo * 10) / 10;
      G.clock = startClock(G.ctx, { bpm: G.BPM, onBeat: metronomeBeat, at });
      G.conductor = new Conductor({ beatsPerBar: 4 });   // the new movement comes in with the whole band
      G.backUntil = at; G.stage3d.setBeat(G.clock.first, G.clock.beatDur);
      bootlog("hydra movement", { movement: m + 1, song: G.song().name, bpm: G.BPM });
      G.hudUI.say(`Movement ${m + 1} — ${G.song().title || G.song().name}`, "good", 2500);
    }, Math.max(0, (at - G.ctx.currentTime - 0.2) * 1000));
  }
  function hydraResults(failed) {
    const stats = gradeRound(hydraOffsets, G.conductor.window * G.clock.beatDur);
    G.results.show({
      round: "Round 4", title: failed ? "The hydra won" : "The hydra falls", stats, last: false, failed,
      nextLabel: failed ? "Fight it again ▶" : "Back to the levels ▶",
      run: { name: G.runName(G.RUN), mult: scoreMultiplier(G.RUN).total },
      onNext: () => { if (failed) { try { sessionStorage.setItem("gr.hydra", JSON.stringify(G.HYDRA)); } catch { /* menu */ } } else { try { sessionStorage.setItem("gr.menuAt", "levels"); } catch { /* fine */ } } location.reload(); },
      onMenu: () => { try { sessionStorage.setItem("gr.menuAt", "levels"); } catch { /* fine */ } location.reload(); },
    });
  }
  function hydraWon() {   // the finale: the whole band at full for two loops, then the G.results
    hydraFinale = true; G.stage3d.hydra.submerge();
    const t = (G.ctx.currentTime - G.clock.first) / G.clock.beatDur; for (const sec of HEAD_SECTION) G.conductor.cue(sec, t);
    G.hudUI.say("🏆 THE HYDRA FALLS — the finale!", "good", 6000);
    setTimeout(() => hydraResults(false), 2 * 4 * G.song().bars * G.clock.beatDur * 1000);
  }
  function hydraLost() { G.life.over = true; G.hudUI.say("The hydra won…", "bad", 4000); setTimeout(() => hydraResults(true), 1400); }

  return { startHydra, hydraGesture, get barBase() { return hydraBarBase; } };
}
