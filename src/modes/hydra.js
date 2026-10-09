/* modes/hydra.js — ROUND 4, THE HYDRA (owner, 2026-10-08: "screw conductor — a full kit and notes… drums are
   kinda constant and notes are the hydra attack… have them spit acid so the drums shield has to stay up").

   You stand on the podium at the end of the dock and play BOTH HANDS at once, cued by a note highway
   (ui/highway.js) under the view of the sea:
     LEFT HAND  the drums (Q W E / A S D) of the movement's song — they hold up the SHIELD (a dome over the
                podium) against the ACID the heads keep lobbing at you (scene/acid.js).
     RIGHT HAND the song's bass + treble notes on J K L ; / U I O P (low → high by pitch) — each one is a STRIKE
                by the movement's head: hit it and the head is wounded, miss it and it bites.
   MOVEMENTS: head 1 attacks to round 1's music, head 2 to round 2's, head 3 to round 3's; a head going down moves
   the band on at the next bar line, at that song's own tempo. All three down: the finale, then the results.
   The rules are game/hydrafight.js (pure, tested). main.js hands in G: getters/setters onto its own state. */
import * as THREE from "three";
import { HydraFight, SHIELD_HOLDS } from "../game/hydrafight.js";
import { startClock } from "../audio/clock.js";
import { gradeRound } from "../game/grade.js";
import { scoreMultiplier } from "../game/run.js";
import { bootlog } from "../bootlog.js";
import { createAcid } from "../scene/acid.js";
import { createAltarKit } from "../scene/altarkit.js";
const { VOICE_PRESETS, voiceSettings } = window.HB_VOICES;

// FIVE AND FIVE (owner, 2026-10-09: "5 drums, 5 cannon/mortar type; drums = left bumper and the D-pad, guns = B X Y A and
// right bumper"). The two toms are one tom here. pad = the standard-mapping button index; glyph = what the highway shows.
const DRUMS = [{ lanes: ["hat"], key: "q", pad: 12, glyph: "↑" }, { lanes: ["snare"], key: "w", pad: 14, glyph: "←" },
  { lanes: ["crash"], key: "e", pad: 4, glyph: "LB" }, { lanes: ["kick"], key: "a", pad: 13, glyph: "↓" },
  { lanes: ["tom low", "tom high"], key: "s", pad: 15, glyph: "→" }];
const GUNS = [{ key: "j", pad: 2, glyph: "X" }, { key: "k", pad: 0, glyph: "A" }, { key: "l", pad: 3, glyph: "Y" },
  { key: "i", pad: 1, glyph: "B" }, { key: "o", pad: 5, glyph: "RB" }];   // lowest → highest
const NOTE_KEYS = GUNS.map((g) => g.key), NG = GUNS.length, ND = DRUMS.length;
const HEAD_COLORS = ["#ff7a5a", "#e8c84a", "#5ad1ff"];
const APPROACH = 1.7;   // seconds a note is on the highway before its beat

export function hydraMode(G) {
  let fight = null, acid = null, highway = null, kit = null, active = false;
  let movement = 0, items = [], L = 16, judged = new Set(), offsets = [], startAt = 0, until = 0;
  let lastTickT = 0, finale = false;
  const metronomeBeat = (time) => G.pool.noteOn({ channel: 0, midi: 72, baseNote: 60, buffer: G.drums.click, velocity: 0.3, when: time, destination: G.mixer.metronome, settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }) });
  const isDrum = (lane) => DRUMS.some((d) => d.lanes.includes(lane));

  /** a song's notes as highway items: drums by name, melody lanes ranked by pitch onto the 8 note columns */
  function itemsOf(song) {
    const play = song.playNotes || song.notes, pitch = (n) => n.midi ?? (song.sounds[n.lane] && song.sounds[n.lane].note) ?? 60;
    const mel = [...new Set(play.filter((n) => !isDrum(n.lane)).map((n) => n.lane))];
    const avg = Object.fromEntries(mel.map((l) => { const ps = play.filter((n) => n.lane === l).map(pitch); return [l, ps.reduce((a, b) => a + b, 0) / ps.length]; }));
    mel.sort((a, b) => avg[a] - avg[b]);
    const colOf = (l) => (mel.length <= 1 ? 2 : Math.round((mel.indexOf(l) * (NG - 1)) / (mel.length - 1)));
    // two notes landing on the same column at the same beat would be one press: keep the first
    const seen = new Set();
    return play.map((n, i) => ({ i, lane: n.lane, beat: n.beat, midi: n.midi, vel: n.vel ?? 0.9,
      col: isDrum(n.lane) ? DRUMS.findIndex((d) => d.lanes.includes(n.lane)) : ND + colOf(n.lane), drum: isDrum(n.lane) }))
      .filter((it) => { const k = it.col + "@" + it.beat.toFixed(3); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  /** how many wounds each head can take: one and a half passes of its movement's notes (at least 8) */
  const hpOf = (song) => Math.max(8, Math.round(1.5 * (song.playNotes || song.notes).filter((n) => !isDrum(n.lane)).length));

  // THE GUNS (10-09): five bronze guns along the altar's sea edge, low to high left to right; a hit fires a bolt at the attacker
  let bolts = [];
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  function fireGun(g) {
    const from = kit && kit.muzzle(g), H = G.stage3d.hydra; if (!from) return;
    const to = H.mouth(movement) || from.clone().add(new THREE.Vector3(0, 3, 10));
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), boltMat); m.position.copy(from); G.stage3d.scene.add(m);
    bolts.push({ m, from: from.clone(), to: to.clone(), t0: performance.now() / 1000 });
  }
  function updateBolts() {
    const now = performance.now() / 1000;
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i], k = (now - b.t0) / 0.3;
      if (k >= 1) { G.stage3d.scene.remove(b.m); bolts.splice(i, 1); continue; }
      b.m.position.lerpVectors(b.from, b.to, k); b.m.position.y += Math.sin(k * Math.PI) * 0.8;
    }
  }

  function setupMovement() {
    const s = G.song(); L = 4 * s.bars; items = itemsOf(s); judged = new Set(); startAt = G.clock.first; until = G.clock.first;

    for (let i = 0; i < 3; i++) G.stage3d.hydra.standBack(i, i !== movement);   // the attacker owns the stage
    bootlog("hydra movement", { movement: movement + 1, song: s.name, bpm: G.BPM, drums: items.filter((x) => x.drum).length, notes: items.filter((x) => !x.drum).length, hp: fight.heads[movement].hp });
  }
  /** which head spits a drum lane's acid: the heads NOT attacking take the drums in turn (the attacker, if it's the last one) */
  function spitterOf(col) { const others = fight.alive.filter((h) => h !== movement), from = others.length ? others : [movement]; return from[col % from.length]; }
  const timeOf = (k, it) => G.clock.first + (k * L + it.beat) * G.clock.beatDur;

  function startHydra() {
    const songs = G.HYDRA.rounds.map((i) => G.lessonAt(i));
    const dmg = { gentle: 0.7, normal: 1, harsh: 1.4 }[G.RUN.damage] || 1;   // the run's Damage setting, as in rounds 1-3
    fight = new HydraFight({ hp: songs.map(hpOf), life: 100, bite: 2.5 * dmg, acid: 4 * dmg });
    G.stage3d.setStation("sea");   // re-read the play spot: his altar may have loaded after the camera was placed
    const H = G.stage3d.hydra; H.rise();
    acid = createAcid(G.stage3d.scene, { center: G.stage3d.playSpot(), radius: 6 });   // over his altar (the play spot)   // wide: the acid bursts on it well out in front of you
    acid.onLand = (head) => { const ev = fight.acidLands(head); events(ev); return ev.some((e) => e.type === "acidBlocked"); };
    // THE KIT ON THE ALTAR (10-09: "the drums on the screen, much like the other lanes"): 3-D drums + guns with cue lanes, in place of
    // the flat highway — `highway` below is a thin stand-in so the round's code stays as it was (draw / flash)
    const DRUM_HEX = ["#3adcff", "#ff4fa0", "#a8ff3a", "#9a5cff", "#ffd23a"];   // hat snare crash kick tom — the courtyard kit's colours
    kit = createAltarKit(G.stage3d.scene, { spot: G.stage3d.playSpot(), approach: APPROACH,
      drums: DRUMS.map((d, i) => ({ label: `${d.key.toUpperCase()} ${d.glyph}`, color: DRUM_HEX[i] })),
      guns: GUNS.map((g) => ({ label: `${g.key.toUpperCase()} ${g.glyph}` })) });
    highway = { draw: (items, now) => kit.update(items, now), flash: (c, good) => kit.press(c, good), show: (on) => { kit.root.visible = on; kit.station.visible = on; },
      setNoteColor() {}, el: { dataset: {} } };
    highway.show(true); active = true; movement = 0;
    setupMovement(); recolor();
    G.hudUI.setLife(100, 100);
    G.hudUI.say("THE HYDRA — left hand: drums keep the shield up (Q W E A S · LB + D-pad) · right hand: the guns fire on the notes (J K L I O · X A Y B RB)", "good", 8000);
    lastTickT = G.ctx.currentTime;
    setInterval(tick, 25);
    const draw = () => {
      if (active) { const H = G.stage3d.hydra, m = H.mouth(movement); if (m) kit.setGunSource(m);   // the strikes come out of the attacker's mouth
        kit.setDrumSources((col) => H.mouth(spitterOf(col)));                                        // the acid out of the others' mouths
        highway.draw(upcoming(), G.ctx.currentTime, APPROACH); acid.update(G.ctx.currentTime); updateBolts(); }
      requestAnimationFrame(draw); };
    requestAnimationFrame(draw);
  }
  function recolor() {   // the note lanes take the attacking head's colour
    const c = HEAD_COLORS[movement]; highway.el.dataset.head = movement;
    highway.setNoteColor(c);
  }
  /** the occurrences on the highway now */
  function upcoming() {
    if (!G.clock) return [];
    const now = G.ctx.currentTime, b0 = (now - 0.2 - G.clock.first) / G.clock.beatDur, b1 = (now + APPROACH - G.clock.first) / G.clock.beatDur, out = [];
    for (let k = Math.floor(b0 / L); k <= Math.floor(b1 / L); k++) for (const it of items) {
      const t = timeOf(k, it); if (t < startAt || judged.has(k + ":" + it.i)) continue;
      if (t >= now - 0.2 && t <= now + APPROACH) out.push({ col: it.col, at: t, k, it });
    }
    return out;
  }

  function tick() {
    if (!active || !G.clock || finale) return;
    const now = G.ctx.currentTime, win = G.judgeWindow(), bd = G.clock.beatDur;
    // MISSES: an occurrence whose moment (plus the hitbox) went by unhit
    const bNow = (now - win - G.clock.first) / bd;
    for (let k = Math.max(0, Math.floor((bNow - L) / L)); k <= Math.floor(bNow / L); k++) for (const it of items) {
      const t = timeOf(k, it), id = k + ":" + it.i;
      if (t < startAt || t + win > now || judged.has(id)) continue;
      judged.add(id); offsets.push(null);
      if (it.drum) {   // the glob got through: the shield drops, and it burns as hard as the shield is down
        events(fight.drum(false)); events(fight.acidLands(spitterOf(it.col))); highway.flash(it.col, false);
        acid.burst(kit.targetPos(it.col), true);
      }
      else { events(fight.strike(movement, false)); highway.flash(it.col, false); }
    }
    // the shield sags with time; the head of this movement rears while a strike is close
    fight.tick((now - lastTickT) / bd); lastTickT = now;
    const H = G.stage3d.hydra, soon = upcoming().some((u) => !u.it.drum && u.at - now < 0.7);
    H.rear(movement, soon);
    // (10-09: the separate acid shower is gone — THE DRUM NOTES ARE THE ACID now: each one a glob spat down its drum's lane)
    G.hudUI.setShield(fight.shield * 100, fight.shield >= SHIELD_HOLDS ? "up" : "broken");
    acid.setShield(fight.shield);
  }

  /** a key in round 4 (press = the heard time of the press); true if it was one of ours */
  function key(e, press) {
    if (!active || e.repeat) return false;
    const k = e.key.toLowerCase(), d = DRUMS.findIndex((x) => x.key === k), n = NOTE_KEYS.indexOf(k);
    if (d < 0 && n < 0) return false;
    e.preventDefault();
    hit(d >= 0 ? d : ND + n, press);
    return true;
  }
  /** a controller button (standard mapping index) — main.js routes them here in round 4 */
  function pad(i, press) {
    if (!active) return;
    const d = DRUMS.findIndex((x) => x.pad === i), n = GUNS.findIndex((x) => x.pad === i);
    if (d >= 0 || n >= 0) hit(d >= 0 ? d : ND + n, press);
  }
  function hit(col, press) {
    const d = col < ND ? col : -1, win = G.judgeWindow(), bd = G.clock.beatDur;
    // the nearest unhit occurrence in this column, inside the hitbox
    let best = null, bestD = Infinity;
    const bp = (press - G.clock.first) / bd;
    for (let kk = Math.floor(bp / L) - 1; kk <= Math.floor(bp / L) + 1; kk++) for (const it of items) {
      if (it.col !== col || kk < 0) continue;
      const t = timeOf(kk, it), id = kk + ":" + it.i;
      if (t < startAt || judged.has(id)) continue;
      const dd = Math.abs(t - press); if (dd < bestD) { bestD = dd; best = { id, it, off: press - t }; }
    }
    if (best && bestD <= win) {
      judged.add(best.id); offsets.push(best.off);
      const entry = G.KEYMAP_BY_LANE[best.it.lane];
      if (entry) G.pool.noteOn({ channel: entry.idx, midi: 60, baseNote: 60, ...G.laneSound(entry.ln, best.it.midi), velocity: best.it.vel, when: G.ctx.currentTime });
      highway.flash(col, true);
      if (!best.it.drum) fireGun(col - ND);   // the gun on the altar fires at the attacking head
      else acid.burst(kit.targetPos(col), false);   // the drum blocked the glob: it splashes off
      events(best.it.drum ? fight.drum(true) : fight.strike(movement, true));
    } else {   // nothing due here: a drum still sounds (quietly); a note key does nothing
      if (d >= 0) { const entry = G.KEYMAP_BY_LANE[DRUMS[d].lanes[0]]; if (entry) G.pool.noteOn({ channel: entry.idx, midi: 60, baseNote: 60, ...G.laneSound(entry.ln), velocity: 0.35, when: G.ctx.currentTime }); }
      highway.flash(col, false);
    }
  }

  // the BAND: what you don't play (the run's simpler patterns leave some notes out) plays by itself
  setInterval(() => {
    if (!active || !G.clock || !G.pool) return;
    const s = G.song(), back = s.backingNotes || [], to = G.ctx.currentTime + 0.12, bd = G.clock.beatDur;
    const b0 = (until - G.clock.first) / bd, b1 = (to - G.clock.first) / bd;
    for (let k = Math.floor(b0 / L); k <= Math.floor(b1 / L); k++) for (const n of back) {
      const b = k * L + n.beat, entry = G.KEYMAP_BY_LANE[n.lane];
      if (b < b0 || b >= b1 || b < 0 || !entry) continue;
      G.pool.noteOn({ channel: entry.idx + 40, midi: 60, baseNote: 60, ...G.laneSound(entry.ln, n.midi), velocity: (n.vel ?? 0.9) * 0.8, when: G.clock.first + b * bd });
    }
    until = Math.max(until, to);
  }, 25);

  function events(evs) {
    const H = G.stage3d.hydra, now = performance.now() / 1000;
    for (const e of evs) {
      if (e.type !== "drumHit" && e.type !== "drumMiss" && e.type !== "acidBlocked") bootlog("hydra", e);
      if (e.type === "wound") H.hit(e.head, now);
      else if (e.type === "bite") { H.rear(e.head, false); H.bite(e.head, now); G.hurtFlash(); }
      else if (e.type === "acidBurn") G.hurtFlash();
      else if (e.type === "down") {
        H.down(e.head);
        G.hudUI.say(`🐉 Head ${e.head + 1} is DOWN!`, "good", 3000);
        if (!fight.won) nextMovement(e.head + 1);
      } else if (e.type === "won") won();
      else if (e.type === "lost") lost();
    }
    G.hudUI.setLife(fight.life, fight.life);
    const h = fight.heads[movement];
    G.hudUI.setPart(`Round 4 · The Hydra · head ${movement + 1} of 3 · ${h ? Math.max(0, h.hp) : 0} wounds to go`);
  }

  /** the next head attacks to the next round's music, from exactly the next bar line, at that song's own tempo */
  function nextMovement(m) {
    const bd = G.clock.beatDur, nextBarBeat = (Math.floor((G.ctx.currentTime - G.clock.first) / bd / 4) + 1) * 4, at = G.clock.first + nextBarBeat * bd;
    setTimeout(() => {
      G.clock.stop();
      movement = m; G.roundIdx = G.HYDRA.rounds[m];
      G.BPM = Math.round((G.song().bpm || 80) * G.RUN.tempo * 10) / 10;
      G.clock = startClock(G.ctx, { bpm: G.BPM, onBeat: metronomeBeat, at });
      G.backUntil = at; G.stage3d.setBeat(G.clock.first, G.clock.beatDur);
      setupMovement(); recolor();
      G.hudUI.say(`Head ${m + 1} attacks — ${G.song().title || G.song().name}`, "bad", 2500);
    }, Math.max(0, (at - G.ctx.currentTime - 0.2) * 1000));
  }
  function results(failed) {
    active = false; highway.show(false); acid.clear();
    const stats = gradeRound(offsets, G.judgeWindow());
    G.results.show({
      round: "Round 4", title: failed ? "The hydra won" : "The hydra falls", stats, last: false, failed,
      nextLabel: failed ? "Fight it again ▶" : "Back to the levels ▶",
      run: { name: G.runName(G.RUN), mult: scoreMultiplier(G.RUN).total },
      onNext: () => { try { if (failed) sessionStorage.setItem("gr.hydra", JSON.stringify(G.HYDRA)); else sessionStorage.setItem("gr.menuAt", "levels"); } catch { /* menu */ } location.reload(); },
      onMenu: () => { try { sessionStorage.setItem("gr.menuAt", "levels"); } catch { /* fine */ } location.reload(); },
    });
  }
  function won() {   // the finale: the heads sink, the band plays one more loop, then the results
    finale = true; G.stage3d.hydra.submerge(); acid.clear(); highway.show(false);
    G.hudUI.say("🏆 THE HYDRA FALLS!", "good", 6000);
    setTimeout(() => results(false), L * G.clock.beatDur * 1000);
  }
  function lost() { G.life.over = true; G.hudUI.say("The hydra won…", "bad", 4000); setTimeout(() => results(true), 1400); }

  /** THE BIG TO-DO's end (10-09): round 3's clock stops, the first movement's starts, the fight begins — no page reload */
  function startInPage() {
    if (G.clock) G.clock.stop();
    G.BPM = Math.round((G.song().bpm || 80) * G.RUN.tempo * 10) / 10;
    G.clock = startClock(G.ctx, { bpm: G.BPM, onBeat: metronomeBeat });
    G.stage3d.setBeat(G.clock.first, G.clock.beatDur);
    startHydra();
  }
  return {
    startHydra, startInPage, key, pad,
    get active() { return active; }, get fight() { return fight; }, get movement() { return movement; },
    upcoming,   // harness: what's on the highway
  };
}
