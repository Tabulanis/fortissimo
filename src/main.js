/* main.js — Garden Rhythm beat core.
   Start button -> AudioContext (created inside the click), drums rendered,
   metronome click scheduled ahead of the audio clock, instant kicks on lane
   keys with timing judged against the chart (known in advance), mapped to
   velocity. First-person 3D courtyard on canvas#stage: flaming arrows fly in
   on the audio clock (the arrows ARE the notes). The timing histogram lives on
   its own canvas#chart. A calibration mode removes the player's systematic
   offset. */

import "./audio/voices.js";
import { makeDrums } from "./audio/drums.js";
import { startClock } from "./audio/clock.js";
import { nearestOnGrid, nearestInLoop, velocityFor, label, OFF_CHART, OFF_VEL } from "./game/judge.js";
import { LAYOUT, CHART } from "./game/chart.js";
import { Ghosts } from "./game/ghosts.js";
import { SessionLog } from "./game/session.js";
import { createStage3D } from "./scene/stage3d.js";
import { Bell } from "./game/bell.js";
import { Loops } from "./game/loops.js";
import { DIFFICULTY } from "./game/difficulty.js";
import { ROUNDS, partArrows, isShown, buildUp } from "./game/stages.js";
import { gradeRound } from "./game/grade.js";
import { createResults } from "./ui/results.js";
import { showLocked } from "./ui/locked.js";
import { createHud } from "./ui/hud.js";
import { createMixer } from "./audio/mixer.js";
import { loadSettings, createSettings } from "./ui/settings.js";
import { createPads } from "./input/pads.js";
import { bootlog } from "./bootlog.js";
import { makeMelodyVoices } from "./audio/melody.js";
import { instrumentNotes, BASS_OCTAVE, TREBLE_OCTAVE } from "./game/scales.js";
bootlog("page", { ua: navigator.userAgent, screen: `${screen.width}x${screen.height}`, dpr: window.devicePixelRatio,
  view: `${innerWidth}x${innerHeight}`, memGB: navigator.deviceMemory, cores: navigator.hardwareConcurrency });
window.addEventListener("error", (e) => bootlog("error", { msg: String(e.message), at: `${e.filename}:${e.lineno}` }));
window.addEventListener("unhandledrejection", (e) => bootlog("rejection", { msg: String(e.reason && (e.reason.stack || e.reason)).slice(0, 600) }));

const { VoicePool, VOICE_PRESETS, voiceSettings } = window.HB_VOICES;

const hud = document.querySelector("#hud");
const stage = document.querySelector("#stage");
const chart = document.querySelector("#chart");
const ctx2d = chart.getContext("2d");
const SET = loadSettings();         // saved settings (Esc / gear)
let difficulty = DIFFICULTY[SET.difficulty] || DIFFICULTY.easy;   // sets "correct enough" and the tempo
const BPM = difficulty.bpm;
const CALIB_KEY = "gr.calib";

// --- drum colours (hex strings; shared by the 3D stage and the chart) ------
const DRUM_COLOR = {
  hat: "#8ac", snare: "#f8a", crash: "#ce8",
  kick: "#a8f", tomLow: "#da6", tomHigh: "#fa4",
};

// --- the 3D stage (created once at load; canvas#stage becomes WebGL) --------
const stage3d = createStage3D(stage, LAYOUT, DRUM_COLOR);
bootlog("stage3d built");
stage.addEventListener("webglcontextlost", () => bootlog("WEBGL CONTEXT LOST"));
// once running: a heartbeat with the frame rate, so a later crash shows when
{ let frames = 0; const tick = () => { frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  setInterval(() => {
    const a = stage3d.debugArrows ? stage3d.debugArrows() : {};
    bootlog("alive", { fps: Math.round(frames / 5), started: !!ctx,
      round: roundIdx + 1, part: stageIdx + 1, wants: [...new Set(currentPart().map((n) => n.lane))],
      flying: a.flying, shown: a.shown && a.shown.map((v) => (v ? 1 : 0)).join(""), taps: recentTaps.splice(0) });
    frames = 0;
  }, 5000); }
if (stage3d.mobile) document.documentElement.classList.add("touch");   // touch layout (no keyboard hints)
window.__gr = { stage3d };   // debug handle for the browser harness

// --- the song: parts unlock two drums at a time; the ghost bell locks them ---
const LANE_INDEX = {};                    // lane name -> target 0..21
[...LAYOUT.top, ...LAYOUT.bottom].forEach((ln, i) => { LANE_INDEX[ln.name] = i; });
// melody bars: "bass 1".."bass 8" -> 6..13, "treble 1".."treble 8" -> 14..21
for (let k = 0; k < 8; k++) { LANE_INDEX[`bass ${k + 1}`] = 6 + k; LANE_INDEX[`treble ${k + 1}`] = 14 + k; }
let stageIdx = 0;
let bell = null;                          // created when the clock starts
let loops = null;                         // locked measures, replayed exactly as played
// 3 ROUNDS in the same arena; each ends with an accuracy grade
let roundIdx = 0;
// Easy teaches every part in steps (on-beat core first, then the add-on over its ghost)
const EASY_ROUNDS = ROUNDS.map(buildUp);
const song = () => (difficulty === DIFFICULTY.easy ? EASY_ROUNDS : ROUNDS)[roundIdx];
const lastRound = () => roundIdx >= ROUNDS.length - 1;
const songDone = () => stageIdx >= song().parts.length;
const currentPart = () => (songDone() ? [] : song().parts[stageIdx].part);
const partObj = () => (songDone() ? null : song().parts[stageIdx]);
const partBars = () => (partObj() && partObj().bars) || 1;            // melody takes can be long
const partMode = () => (partObj() && partObj().mode) || "drums";       // "drums" | "bass" | "treble"
const isMelody = () => partMode() !== "drums";
let padConnected = false;   // a game controller is plugged in (the bars then show its buttons)
let roundOffsets = [];          // every guided hit this round: seconds off its note, null = off-chart
const results = createResults();
const hudUI = createHud({ onBell: ringBell, onHint: () => playHint() });
let autoCorrect = SET.autoCorrect;   // A toggles; also in settings
function showDifficulty() { hudUI.setDifficulty(`${difficulty.name}${autoCorrect ? " · Auto ✓" : ""}`); }
showDifficulty();
const settingsUI = createSettings({
  onChange: (k, v) => {
    if (k === "autoCorrect") { autoCorrect = v; showDifficulty(); return; }
    if (mixer) mixer.setVolume(k, v);
  },
  onRestart: () => location.reload(),   // difficulty sets the tempo the clock starts at
});

// where a hit is RECORDED: snapped onto its note (or, with no notes to follow,
// the nearest eighth) when auto-correct is on and it landed inside the box
function autoCorrectHit(press, vel, j, free) {
  if (!autoCorrect || !clock) return { t: press, velocity: vel };
  const box = difficulty.window;
  if (!free && j && Math.abs(j.offset) <= box) return { t: j.time, velocity: Math.max(vel, 0.95) };
  if (free) {
    const g = nearestOnGrid(clock.first, clock.beatDur / 2, press);   // eighth notes
    if (Math.abs(g.offset) <= box) return { t: g.time, velocity: vel };
  }
  return { t: press, velocity: vel };
}
hudUI.setLives(3);

function applyStage() {
  for (let i = 0; i < 6; i++) stage3d.setDrumVisible(i, isShown(song(), stageIdx, i));
  stage3d.setStation(isMelody() ? partMode() : "drums");   // bass: turn right, treble: turn left
  stageMessage();
}

// the standing instruction for where you are in the song
function stageMessage() {
  if (bell && bell.state !== "idle") return;   // the bell's own messages win while it works
  hudUI.setPart(songDone() ? (lastRound() ? "Free play" : `${song().name} done`)
    : `${song().name} · ${song().parts[stageIdx].label} of ${song().parts.length}`);
  if (songDone() && !lastRound()) {
    hudUI.say(`${song().name} complete!`, "good");
  } else if (songDone()) {
    hudUI.say("Song complete! Play anything — ring the bell 🔔 to add a measure", "good");
  } else {
    const m = partMode(), bars = partBars();
    const take = bars > 1 ? ` (${bars}-bar take)` : "";
    if (m !== "drums") {
      const where = m === "bass" ? "Bass — turned right" : "Treble — turned left";
      const how = stage3d.mobile ? "tap the bars" : padConnected ? "D-pad + X A B Y" : "keys A S D F · H J K L";
      hudUI.say(`${where}: ${how}${take}. Got it? Ring the bell 🔔 ${padConnected ? "(Menu)" : stage3d.mobile ? "" : "(Space)"}`);
    } else {
      hudUI.say(stage3d.mobile ? "Follow the arrows — tap the drums. Got it? Tap the bell 🔔"
        : "Follow the arrows. Got it? Ring the bell 🔔 (Space)");
    }
  }
}

function ringBell() {
  if (!bell || !ctx) { hudUI.say("Press Start first", "bad", 1500); return; }
  if (bell.state !== "idle") return;
  bell.ring(ctx.getOutputTimestamp().contextTime, partBars());
  hudUI.setBellState("armed");
  hudUI.say("Get ready — recording starts on the next bar…");
}

// called every frame: has a recorded measure finished?
function tickBell(heardNow) {
  if (!bell) return;
  const free = mode === "free" || songDone();
  const r = bell.tick(heardNow, { part: currentPart(), diff: difficulty, free });
  hudUI.setBellState(bell.state);
  if (bell.state === "recording" && !r) hudUI.say("● Recording this measure…");
  if (!r) return;
  if (r.locked) {
    loops.add(r.layer);
    // the scheduler may already be past this loop's first notes (it looks
    // 0.1 s ahead) — schedule the new layer's notes up to that point now
    if (ctx && pool) {
      const one = new Loops(4 * clock.beatDur); one.add(r.layer);
      for (const e of one.events(ctx.currentTime, scheduledUntil, clock.first)) {
        const entry = KEYMAP_BY_LANE[e.lane];
        if (!entry) continue;
        pool.noteOn({ channel: entry.idx + 40, midi: 60, baseNote: 60, buffer: laneBuffer(entry.ln),
          velocity: e.velocity * 0.85, when: e.time, destination: laneDest(entry.ln),
          settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }) });
      }
    }
    const wasGuided = !songDone();
    if (wasGuided) stageIdx++;
    applyStage();
    hudUI.say(`Locked in! ✨ (${r.judge.matched}/${r.judge.total})`, "good");
    showLocked();   // the big slam
    setTimeout(stageMessage, 2500);   // then back to the standing instruction (it used to go blank)
    if (wasGuided && songDone()) setTimeout(endRound, 1600);   // the band plays the full song a moment, then the grade
  } else {
    hudUI.say(`Not quite (${r.judge.matched}/${r.judge.total}) — keep playing, it's still listening`, "bad");
  }
}
applyStage();

// end of a round: the grade, then the next round in the same arena (fresh song,
// fresh loops); after the last round, free play
function endRound() {
  const stats = gradeRound(roundOffsets, difficulty.window);
  results.show({
    round: song().name, title: song().title, stats, last: lastRound(),
    onNext: async () => {
      if (lastRound()) { stageMessage(); return; }
      roundIdx++;
      await buildMelodyVoices();   // the new round's key + scale
      stageIdx = 0;
      roundOffsets = [];
      if (loops) loops.clear();
      if (bell) bell.cancel();
      applyStage();
    },
  });
}

let ctx = null;
let masterGain = null;
let mixer = null;          // the mixing desk: lane strips, drum bus, reverb, limiter
let drums = null;
let pool = null;
let clock = null;

// --- timing chart ---------------------------------------------------------
let offsets = [];          // every press offset (ms), after calibration
let flashes = [];          // lane-segment flashes: { idx, kind, until }

// --- drum-mode lane map ----------------------------------------------------
// key -> { lane index (0..5), lane } built once from the layout.
const KEYMAP = {};
{
  let idx = 0;
  for (const ln of [...LAYOUT.top, ...LAYOUT.bottom]) {
    KEYMAP[ln.key] = { idx: idx++, ln };
  }
}
// lane NAME -> entry (ghost events carry lane names)
const KEYMAP_BY_LANE = {};
for (const e of Object.values(KEYMAP)) KEYMAP_BY_LANE[e.ln.name] = e;
// the 16 melody bars as lanes: "bass 1".."bass 8", "treble 1".."treble 8"
const MELODY_KEYS = { a: 0, s: 1, d: 2, f: 3, h: 4, j: 5, k: 6, l: 7 };
const MELODY_LETTERS = ["A", "S", "D", "F", "H", "J", "K", "L"];
const PAD_LABELS = ["dL", "dD", "dR", "dU", "X", "A", "B", "Y"];   // drawn as D-pad arrows / face letters
const MELODY_ENTRY = { bass: [], treble: [] };
for (const kind of ["bass", "treble"]) {
  for (let slot = 0; slot < 8; slot++) {
    const name = `${kind} ${slot + 1}`;
    const e = { idx: 6 + (kind === "treble" ? 8 : 0) + slot, ln: { name, key: MELODY_LETTERS[slot].toLowerCase(), kind, slot } };
    KEYMAP_BY_LANE[name] = e;
    MELODY_ENTRY[kind][slot] = e;
  }
}
// the melody voices, built for the current round's key + scale
let melodyVoices = { bass: [], treble: [] };
async function buildMelodyVoices() {
  if (!ctx) return;
  const { key = "C", scale = "major" } = song();
  const [b, t] = await Promise.all([
    makeMelodyVoices(ctx.sampleRate, instrumentNotes({ key, scale, octave: BASS_OCTAVE }), "bass"),
    makeMelodyVoices(ctx.sampleRate, instrumentNotes({ key, scale, octave: TREBLE_OCTAVE }), "treble"),
  ]);
  melodyVoices = { bass: b, treble: t };
}
// one place that knows where a lane's sound comes from and where it goes
const laneBuffer = (ln) => (ln.kind ? melodyVoices[ln.kind][ln.slot] : drums[ln.drum]);
const laneDest = (ln) => mixer.lane(ln.kind || ln.name);

// --- calibration ----------------------------------------------------------
let calibration = loadCalib();   // seconds, subtracted from every press time
let calib = null;                // active session: { hits: number[] }

// --- freestyle mode ---------------------------------------------------------
// "drum" = chart + timing judgement, as before. "free" = no chart notes, no
// timing judgement, no timing-chart entries: every lane press plays its drum
// immediately at velocity 1.0. Metronome click and ghost loops keep working
// exactly as in drum mode (presses are still recorded into ghosts).
let mode = "drum";
let session = null;

function loadCalib() {
  try {
    const v = parseFloat(localStorage.getItem(CALIB_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function makeCalibrateButton() {
  const btn = document.createElement("button");
  btn.textContent = "Calibrate";
  btn.style.cssText =
    "position:fixed;bottom:24px;left:8px;z-index:21;font:13px monospace;" +
    "padding:6px 14px;background:#131;color:#fc6;border:1px solid #fc6;cursor:pointer";
  btn.addEventListener("click", () => {
    if (!clock || calib) return;
    calib = { hits: [] };
    offsets = [];
  });
  document.body.appendChild(btn);
  return btn;
}

function makeStartButton() {
  const btn = document.createElement("button");
  btn.textContent = "Start";
  btn.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:21;font:22px system-ui;border-radius:12px;" +
    "padding:18px 48px;background:#2a1606;color:#ffd27a;border:2px solid #ffb84a;cursor:pointer;box-shadow:0 0 30px rgba(255,170,60,.45)";
  btn.addEventListener("click", async () => {
    bootlog("start tapped");
    if (ctx) return;
    ctx = new AudioContext();
    await ctx.resume();
    mixer = createMixer(ctx);
    for (const k of ["master", "hits", "metronome"]) mixer.setVolume(k, SET[k]);
    masterGain = mixer.master;

    drums = await makeDrums(ctx.sampleRate);
    await buildMelodyVoices();   // bass + treble in this round's key
    pool = new VoicePool(ctx);

    clock = startClock(ctx, {
      bpm: BPM,
      onBeat: (time, n) => {
        const active = bell && bell.state !== "idle";
        if (active) setTimeout(() => hudUI.tick(), Math.max(0, (time - ctx.currentTime) * 1000));
        pool.noteOn({
          channel: 0,
          midi: active ? 84 : 72,          // the bell ticks brighter while it counts / records
          baseNote: 60,
          buffer: drums.click,
          velocity: active ? 0.9 : 0.35,
          when: time,
          destination: mixer.metronome,
          settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
        });
      },
    });

    bell = new Bell({ first: clock.first, beatDur: clock.beatDur });
    loops = new Loops(4 * clock.beatDur);
    ghosts = loops;   // the scheduler below replays loop layers
    session = new SessionLog({
      bpm: BPM,
      loopBeats: CHART.loopBeats,
      layout: LAYOUT,
    });
    scheduledUntil = clock.first;
    setInterval(scheduleGhosts, 25);

    btn.remove();
    hud.textContent = modeStr();
  });
  document.body.appendChild(btn);
  return btn;
}

// --- LISTEN (hint) ---------------------------------------------------------
// Plays the WHOLE section once, in time, from the next bar line (a long phrase:
// from its own grid): the full drum groove, or the full bass line, or the full
// melody — the original, even when Easy teaches it in steps. Each note sounds
// through its instrument, its drum/bar flashes and the ghost hands play it.
let hint = null;   // { notes: [{laneIdx, time, velocity, flashed}], end }
function sectionNotes(mode) {
  const parts = ROUNDS[roundIdx].parts.filter((p) => p.mode === mode);
  return { notes: parts.flatMap((p) => p.part), bars: Math.max(1, ...parts.map((p) => p.bars || 1)) };
}
function playHint() {
  if (!ctx || !clock || !pool || !drums) { hudUI.say("Press Start first", "bad", 1500); return; }
  const mode = songDone() ? "drums" : partMode();
  const { notes, bars } = sectionNotes(mode);
  const barDur = 4 * clock.beatDur, phrase = barDur * bars;
  const now = ctx.getOutputTimestamp().contextTime;
  const start = clock.first + Math.ceil((now + 0.15 - clock.first) / phrase) * phrase;
  hint = { notes: [], end: start + phrase };
  for (const n of notes) {
    const entry = KEYMAP_BY_LANE[n.lane];
    if (!entry) continue;
    const time = start + n.beat * clock.beatDur;
    pool.noteOn({ channel: entry.idx + 70, midi: 60, baseNote: 60, buffer: laneBuffer(entry.ln), velocity: 0.8,
      when: time, destination: laneDest(entry.ln), settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }) });
    hint.notes.push({ laneIdx: entry.idx, time, velocity: 0.9, flashed: false });
  }
  const what = mode === "drums" ? "the full beat" : mode === "bass" ? "the bass line" : "the melody";
  hudUI.say(`👂 Listen — ${what}${bars > 1 ? ` (${bars} bars)` : ""}`, "good", Math.max(2500, (start + phrase - now) * 1000));
}

// --- ghost loops -----------------------------------------------------------
// What was played in a pass replays as a ghost from the NEXT pass on, quieter
// than live play, on its own channels (laneIndex + 10) so live presses never
// cut a ghost. Recorded exactly as played — never snapped. G toggles.
let ghosts = null;
let ghostsOn = true;
let scheduledUntil = 0;

function scheduleGhosts() {
  if (!ghosts || !ctx || !pool || !ghostsOn) return;
  const until = ctx.currentTime + 0.1;
  const evs = ghosts.events(scheduledUntil, until, clock.first);
  for (const e of evs) {
    const entry = KEYMAP_BY_LANE[e.lane];
    if (!entry) continue;
    pool.noteOn({
      channel: entry.idx + 40,   // ghosts on their own channels: live play never cuts them
      midi: 60,
      baseNote: 60,
      buffer: laneBuffer(entry.ln),
      velocity: e.velocity * 0.85,   // exactly as played, a touch under live play
      when: e.time,
      destination: laneDest(entry.ln),
      settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
    });
  }
  scheduledUntil = until;
}

// --- keydown ---------------------------------------------------------------
// Drum mode: each lane key plays that lane's drum IMMEDIATELY on its own
// channel; timing only changes loudness (velocityFor) — never delay or snap
// the sound. Calibration keeps its old F/Space taps against the metronome.
function onKey(e) {
  // start-up guard: drums, pool and clock must all exist before a press
  if (e.repeat || !ctx || !drums || !pool || !clock) return;

  // press time on the audio clock, from the event's own timestamp
  const ts = ctx.getOutputTimestamp();
  const press =
    ts.contextTime + (e.timeStamp - ts.performanceTime) / 1000 - calibration;

  if (e.key === "Tab") { e.preventDefault(); playHint(); return; }   // LISTEN to the whole section

  // at the bars: A S D F / H J K L play notes 1-8 (the A/F/H shortcuts are drums-only)
  if (isMelody()) {
    const slot = MELODY_KEYS[e.key.toLowerCase()];
    if (slot != null) {
      e.preventDefault();
      const entry = MELODY_ENTRY[partMode()][slot];
      hitLane(entry.idx, entry.ln, press, 1);
      return;
    }
  }

  if (e.key === "g" || e.key === "G") {
    e.preventDefault();
    ghostsOn = !ghostsOn;
    return;
  }

  if (e.key === "m" || e.key === "M") {
    e.preventDefault();
    mode = mode === "drum" ? "free" : "drum";
    if (clock) hud.textContent = modeStr();
    return;
  }

  if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    saveSession();
    return;
  }

  if (e.key === " ") {
    e.preventDefault();
    ringBell();
    return;
  }

  if (e.key === "a" || e.key === "A") {   // auto-correct on/off
    e.preventDefault();
    autoCorrect = !autoCorrect;
    settingsUI.set("autoCorrect", autoCorrect);
    showDifficulty();
    hudUI.say(autoCorrect ? "Auto-correct ON — hits inside the box record on the beat" : "Auto-correct OFF — loops record exactly as played", "", 1800);
    return;
  }

  if (e.key === "h" || e.key === "H") {   // developer timing chart
    e.preventDefault();
    chart.style.display = chart.style.display === "block" ? "none" : "block";
    resize();
    return;
  }

  if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    const j = nearestOnGrid(clock.first, clock.beatDur, press);
    const vel = velocityFor(j.offset);
    pool.noteOn({
      channel: 0,
      midi: 36,
      baseNote: 60,
      buffer: drums.kick,
      velocity: vel,
      when: ctx.currentTime,
      destination: mixer.lane("kick"),
      settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
    });
    recordPress(j.offset, vel, "kick", label(j.offset));
    return;
  }

  const entry = KEYMAP[e.key];
  if (!entry) return;   // keys outside the layout do nothing, HUD untouched
  e.preventDefault();
  hitLane(entry.idx, entry.ln, press, 1);
}

// ONE drum hit, from any input: keyboard, MIDI pad, game controller, VR stick.
// press = time on the heard audio clock; padVel = the input's own force (0..1,
// 1 for keys) — it scales the loudness on top of the timing.
// --- drum pads and game controllers -------------------------------------------
const pads = createPads({
  melodyMode: () => isMelody(),
  onHint: () => playHint(),
  onMelody: (slot, force, ts) => {
    if (!ctx || !drums || !pool || !clock) return;
    const entry = MELODY_ENTRY[partMode()][slot];
    const o = ctx.getOutputTimestamp();
    hitLane(entry.idx, entry.ln, o.contextTime + (ts - o.performanceTime) / 1000 - calibration, force);
  },
  onHit: (laneName, force, ts) => {
    if (!ctx || !drums || !pool || !clock) return;
    const entry = KEYMAP_BY_LANE[laneName];
    if (!entry) return;
    // the device's own timestamp, on the heard audio clock (like a key press)
    const o = ctx.getOutputTimestamp();
    hitLane(entry.idx, entry.ln, o.contextTime + (ts - o.performanceTime) / 1000 - calibration, force);
  },
  onBell: () => ringBell(),
  onStatus: (st) => {
    // a controller in hand: the bars show its buttons instead of keyboard letters
    padConnected = st.pads.length > 0;
    for (const k of ["bass", "treble"]) stage3d.melodyStations[k].setLabels(padConnected ? PAD_LABELS : MELODY_LETTERS);
    stageMessage();
    const parts = [...st.midi.map((n) => "🥁 " + n), ...st.pads.map((n) => "🎮 " + n.split("(")[0].trim())];
    if (parts.length) hudUI.say("Connected: " + parts.join(" · "), "good", 3000);
  },
});

// --- VR: a stick tip entering a drumhead (force = stick speed) --------------
const KEYMAP_BY_IDX = [];
for (const e of Object.values(KEYMAP)) KEYMAP_BY_IDX[e.idx] = e;
for (const kind of ["bass", "treble"]) for (const e of MELODY_ENTRY[kind]) KEYMAP_BY_IDX[e.idx] = e;
stage3d.setVrHitHandler((idx, force, ms) => {
  if (!ctx || !drums || !pool || !clock) return;
  const entry = KEYMAP_BY_IDX[idx];
  if (!entry) return;
  const o = ctx.getOutputTimestamp();
  hitLane(entry.idx, entry.ln, o.contextTime + (ms - o.performanceTime) / 1000 - calibration, force);
});
stage3d.setVrBellHandler(() => ringBell());
stage3d.addVrButton();

function hitLane(idx, lane, press, padVel = 1) {

  // timing against this lane's chart notes, loop-wrapped
  const partBeats = currentPart().filter((n) => n.lane === lane.name).map((n) => n.beat);
  const j = partBeats.length
    ? nearestInLoop(partBeats, 4 * partBars(), clock.first, clock.beatDur, press)
    : null;
  // off-chart: no note nearby at all — play quietly, label OFF, stay out of the chart
  const free = mode === "free" || songDone() || !partBeats.length;   // not in this part: just play
  let vel, lab, off = false;
  if (free) {
    // freestyle: no judgement, no timing-chart entry — always full velocity
    vel = 0.9;
    lab = "FREE";
  } else {
    // off-chart: no note nearby at all — play quietly, label OFF, stay out of the chart
    off = !j || Math.abs(j.offset) > OFF_CHART;
    vel = off ? OFF_VEL : velocityFor(j.offset);   // off-chart: barely there (-30 dB)
    lab = off ? "OFF" : label(j.offset);
    roundOffsets.push(off ? null : j.offset);
  }
  vel *= padVel;   // a soft pad hit / a slow VR swing plays softer
  if (window.__gr) (window.__gr.hits ||= []).push({ lane: lane.name, lab, force: +padVel.toFixed(2), vel: +vel.toFixed(3) });   // harness readout

  // record exactly as played (real timing, real velocity, mistakes and OFF
  // included) — it becomes this lane's ghost from the next pass on
  // AUTO-CORRECT (quantize): a hit inside the scoring box for its note is
  // RECORDED on the exact beat at full strength; the live sound still fired
  // the instant you hit. Outside the box it's recorded exactly as played.
  if (bell) bell.add({ lane: lane.name, ...autoCorrectHit(press, vel, j, free) });

  // the player IS the instrument: play immediately, on this lane's channel
  pool.noteOn({
    channel: idx,
    midi: 60,
    baseNote: 60,
    buffer: laneBuffer(lane),
    velocity: vel,
    when: ctx.currentTime,
    destination: laneDest(lane),
    settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
  });

  // every press, both modes, lands in the session log
  if (session) session.add({
    lane: lane.name,
    drum: lane.drum,
    t: press,
    velocity: vel,
    mode,
    label: lab,
  });

  // the scene reacts: every press flashes the drum; judged presses also mark
  // the arrow they struck (HIT vanishes at once, NEAR sticks briefly)
  stage3d.press(idx, lab);
  stage3d.strike(idx, lab);   // the player's hand hits that drum, right now
  if (!free && !off) {
    stage3d.hit(idx, j.time, lab === "HIT" ? "HIT" : "NEAR", vel);   // vel = how close to the magic peak
  }

  recordPress(idx, free ? null : (off ? null : j.offset), vel, lane.name, lab);
}

// --- freestyle + save -------------------------------------------------------
function modeStr() {
  return `${mode === "free" ? "FREESTYLE" : "DRUM"}  [M] mode   [P] save`;
}

function saveSession() {
  if (!session || !clock) return;
  const data = session.toJSON(clock.first, { toData: () => ({ layers: loops ? loops._layers : [] }) });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  a.download =
    `garden-rhythm-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  hud.textContent = `${modeStr()}   saved ${data.hits.length} hits`;
}

function recordPress(idx, offsetSec, vel, laneName, lab) {
  const ms = offsetSec == null ? null : offsetSec * 1000;
  flashes.push({
    idx,
    kind: lab === "HIT" ? "hit" : lab === "OFF" ? "off" : "miss",
    until: performance.now() + 120,
  });

  if (calib) {
    if (offsetSec != null) {
      calib.hits.push(offsetSec);
      if (calib.hits.length >= 16) {
        calibration = median(calib.hits);
        try { localStorage.setItem(CALIB_KEY, String(calibration)); } catch {}
        calib = null;
      }
    }
  } else if (offsetSec != null) {
    offsets.push(ms);
  }

  const ghostStr = ghosts
    ? `  loops: ${loops ? loops.count : 0} (${ghostsOn ? "on" : "off"}) [G]`
    : "";
  const modeStr2 = mode === "free"
    ? "  FREESTYLE"
    : "  DRUM";
  hud.textContent =
    `${laneName}  ${lab}${modeStr2}  ` +
    (ms == null
      ? "free"
      : `${ms >= 0 ? "+" : ""}${ms.toFixed(1)} ms  vel ${vel.toFixed(2)}`) +
    `  lat ${(ctx.outputLatency * 1000).toFixed(1)} ms  ` +
    `calib: ${calibration >= 0 ? "+" : ""}${(calibration * 1000).toFixed(1)} ms` +
    ghostStr;
}

// --- upcoming notes (the arrows) -------------------------------------------
// Every chart note for both rows within the next APPROACH window, as
// { laneIdx, time } on the audio clock. Freestyle passes nothing.
const APPROACH_S = 3.2;   // must match stage3d.js

function buildUpcoming(heardNow) {
  // arrows only for the part you're learning; none in free play
  if (mode === "free" || songDone()) return [];
  const part = (window.__gr && window.__gr.game && window.__gr.game.testPart) || currentPart();   // testPart: harness only
  return partArrows(part, (n) => LANE_INDEX[n], clock.first, 4 * partBars() * clock.beatDur,
                    clock.beatDur, heardNow - 0.6, heardNow + APPROACH_S);
}

// --- timing chart (its own canvas) ------------------------------------------
const BIN_MS = 10, LO = -150, NBINS = 30;
const CHART_H = 120;   // CSS px height of the chart band

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
}

function drawChart() {
  const W = chart.clientWidth, H = chart.clientHeight;
  ctx2d.fillStyle = "rgba(10,14,18,0.9)";
  ctx2d.fillRect(0, 0, W, H);
  ctx2d.strokeStyle = "#223";
  ctx2d.strokeRect(0.5, 0.5, W - 1, H - 1);

  if (!offsets.length) {
    ctx2d.fillStyle = "#456";
    ctx2d.font = "11px monospace";
    ctx2d.fillText("no presses yet", 8, 16);
    return;
  }

  const bins = new Array(NBINS).fill(0);
  for (const ms of offsets) {
    let i = Math.floor((ms - LO) / BIN_MS);
    if (i < 0) i = 0;
    if (i >= NBINS) i = NBINS - 1;   // clamp outside values into the end bins
    bins[i]++;
  }
  const max = Math.max(...bins);
  const bw = (W - 20) / NBINS;
  for (let i = 0; i < NBINS; i++) {
    const h = max ? (bins[i] / max) * (H - 24) : 0;
    ctx2d.fillStyle = "#2a6";
    ctx2d.fillRect(10 + i * bw, H - 4 - h, Math.max(1, bw - 1), h);
  }

  const m = mean(offsets), sd = stddev(offsets);
  ctx2d.fillStyle = "#8f8";
  ctx2d.font = "11px monospace";
  ctx2d.fillText(
    `n ${offsets.length}   mean ${m >= 0 ? "+" : ""}${m.toFixed(1)} ms   ` +
    `spread ${sd.toFixed(1)} ms`,
    10, 14,
  );
}

function resize() {
  stage3d.resize();
  const dpr = window.devicePixelRatio || 1;
  chart.width = Math.round(chart.clientWidth * dpr);
  chart.height = Math.round(chart.clientHeight * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame() {
  if (clock && ctx) {
    const heardNow = ctx.getOutputTimestamp().contextTime;
    // loop hits around now, so each spirit stick can lift BEFORE its beat
    const ghostHits = (loops && ghostsOn)
      ? loops.events(heardNow - 0.3, heardNow + 0.6, clock.first)
          .map((e) => ({ laneIdx: LANE_INDEX[e.lane], time: e.time, velocity: e.velocity }))
      : [];
    // LISTEN: the ghost hands demonstrate the hint, and each note's target flashes as it sounds
    if (hint) {
      for (const n of hint.notes) {
        if (n.time > heardNow - 0.3 && n.time < heardNow + 0.6) ghostHits.push(n);
        if (!n.flashed && heardNow >= n.time) { n.flashed = true; stage3d.press(n.laneIdx, "HIT"); }
      }
      if (heardNow > hint.end + 0.4) hint = null;
    }
    stage3d.update(heardNow, buildUpcoming(heardNow), ghostHits);
    tickBell(heardNow);
  } else {
    // before Start: keep the courtyard (and its drums) visible, no arrows
    stage3d.update(0, []);
  }
  pads.poll();
  // the mouse's nudge drifts back to centre once the mouse rests
  const tNow = performance.now();
  const mdt = Math.min(0.05, (tNow - mouseLook.tFrame) / 1000);
  mouseLook.tFrame = tNow;
  if (tNow - mouseLook.tMove > 150) {
    const d = Math.exp(-mdt * 1.6);
    mouseLook.x *= d; mouseLook.y *= d;
  }
  // look around: arrow keys + thumbsticks + mouse (VR ignores it: the head looks)
  const k = (key) => (lookKeys.has(key) ? 1 : 0);
  stage3d.setLookInput(k("ArrowRight") - k("ArrowLeft") + pads.look.x + mouseLook.x,
    k("ArrowUp") - k("ArrowDown") + pads.look.y + mouseLook.y);
  drawChart();
}

// arrow keys held = look around a little
const lookKeys = new Set();
window.addEventListener("keydown", (e) => { if (e.key.startsWith("Arrow")) { lookKeys.add(e.key); e.preventDefault(); } });

window.addEventListener("keyup", (e) => lookKeys.delete(e.key));
window.addEventListener("blur", () => lookKeys.clear());

// mouse look: moving the mouse nudges the view (~300 px = the full turn);
// when it rests, the view eases back to forward. The cursor stays free, and
// the settings panel / buttons never steer the camera.
const mouseLook = { x: 0, y: 0, tMove: 0, tFrame: performance.now() };
let lastTouch = -1e9;

// TOUCH / PEN / CLICK on the 3D view: hit the drum under the finger (any number
// of fingers at once). A finger that lands off the drums drags the view instead.
const drags = new Map();   // pointerId -> last x, y (look-around drags)
const recentTaps = [];     // dev log: where taps landed and which drum they picked
stage.style.touchAction = "none";
stage.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") lastTouch = performance.now();
  const lane = stage3d.pickDrum(e.clientX, e.clientY);
  recentTaps.push(`${Math.round(e.clientX)},${Math.round(e.clientY)}->${lane}`);
  if (recentTaps.length > 12) recentTaps.shift();
  if (lane < 0 || !ctx || !drums || !pool || !clock) {
    if (e.pointerType !== "mouse") { drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { stage.setPointerCapture(e.pointerId); } catch { /* not a live pointer: the drag still works without capture */ } }
    return;
  }
  e.preventDefault();
  const entry = KEYMAP_BY_IDX[lane];
  // the touch's own timestamp, on the heard audio clock (like a key press)
  const o = ctx.getOutputTimestamp();
  const force = e.pointerType === "pen" && e.pressure > 0 ? 0.4 + 0.6 * e.pressure : 1;
  hitLane(entry.idx, entry.ln, o.contextTime + (e.timeStamp - o.performanceTime) / 1000 - calibration, force);
});
stage.addEventListener("pointermove", (e) => {
  const d = drags.get(e.pointerId);
  if (!d) return;
  if (e.pointerType === "touch") lastTouch = performance.now();
  mouseLook.x = Math.max(-1, Math.min(1, mouseLook.x + (e.clientX - d.x) / 250));
  mouseLook.y = Math.max(-1, Math.min(1, mouseLook.y - (e.clientY - d.y) / 250));
  mouseLook.tMove = performance.now();
  d.x = e.clientX; d.y = e.clientY;
});
for (const ev of ["pointerup", "pointercancel"]) stage.addEventListener(ev, (e) => drags.delete(e.pointerId));

// held upright on a phone/tablet: suggest turning it sideways (once per visit)
let toldRotate = false;
function maybeSuggestLandscape() {
  if (toldRotate || !stage3d.mobile || innerWidth >= innerHeight) return;
  toldRotate = true;
  hudUI.say("Turn sideways for the best view ↻", "good", 4000);
}
window.addEventListener("resize", maybeSuggestLandscape);
setTimeout(maybeSuggestLandscape, 1200);
window.addEventListener("mousemove", (e) => {
  if (e.target.closest && e.target.closest("#gr-set, button, input, select, a")) return;
  if (performance.now() - lastTouch < 800) return;   // phones fire fake mouse events after a tap: not a look
  mouseLook.x = Math.max(-1, Math.min(1, mouseLook.x + e.movementX / 300));
  mouseLook.y = Math.max(-1, Math.min(1, mouseLook.y - e.movementY / 300));
  mouseLook.tMove = performance.now();
});

makeStartButton();
makeCalibrateButton();
window.addEventListener("keydown", onKey);
resize();
window.addEventListener("resize", resize);
stage3d.setLoop(frame);
// test hook (the harness robot reads the song state through this)
if (window.__gr) window.__gr.game = {
  get clock() { return clock; }, get ctx() { return ctx; }, get bell() { return bell; },
  get stageIdx() { return stageIdx; }, get roundIdx() { return roundIdx; },
  upcoming: () => (ctx ? buildUpcoming(ctx.getOutputTimestamp().contextTime) : []),
  part: () => currentPart(),
  song: () => song(),
  get hint() { return hint; }, get calibration() { return calibration; }, get loops() { return loops; },
};   // screen or headset: the renderer drives the frames
