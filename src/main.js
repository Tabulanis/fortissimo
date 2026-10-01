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
import { SONG, partArrows, isShown } from "./game/stages.js";
import { createHud } from "./ui/hud.js";
import { createMixer } from "./audio/mixer.js";

const { VoicePool, VOICE_PRESETS, voiceSettings } = window.HB_VOICES;

const hud = document.querySelector("#hud");
const stage = document.querySelector("#stage");
const chart = document.querySelector("#chart");
const ctx2d = chart.getContext("2d");
let difficulty = DIFFICULTY.easy;   // sets "correct enough" and the starting tempo
const BPM = difficulty.bpm;
const CALIB_KEY = "gr.calib";

// --- drum colours (hex strings; shared by the 3D stage and the chart) ------
const DRUM_COLOR = {
  hat: "#8ac", snare: "#f8a", crash: "#ce8",
  kick: "#a8f", tomLow: "#da6", tomHigh: "#fa4",
};

// --- the 3D stage (created once at load; canvas#stage becomes WebGL) --------
const stage3d = createStage3D(stage, LAYOUT, DRUM_COLOR);
window.__gr = { stage3d };   // debug handle for the browser harness

// --- the song: parts unlock two drums at a time; the ghost bell locks them ---
const LANE_INDEX = {};                    // lane name -> 0..5
[...LAYOUT.top, ...LAYOUT.bottom].forEach((ln, i) => { LANE_INDEX[ln.name] = i; });
let stageIdx = 0;
let bell = null;                          // created when the clock starts
let loops = null;                         // locked measures, replayed exactly as played
const songDone = () => stageIdx >= SONG.parts.length;
const currentPart = () => (songDone() ? [] : SONG.parts[stageIdx].part);
const hudUI = createHud({ onBell: ringBell });
hudUI.setDifficulty(difficulty.name);
hudUI.setLives(3);

function applyStage() {
  for (let i = 0; i < 6; i++) stage3d.setDrumVisible(i, isShown(stageIdx, i));
  stageMessage();
}

// the standing instruction for where you are in the song
function stageMessage() {
  if (bell && bell.state !== "idle") return;   // the bell's own messages win while it works
  hudUI.setPart(songDone() ? "Free play" : `${SONG.parts[stageIdx].label} of ${SONG.parts.length}`);
  if (songDone()) {
    hudUI.say("Song complete! Play anything — ring the bell 🔔 to add a measure", "good");
  } else {
    hudUI.say("Follow the arrows. Got it? Ring the bell 🔔 (Space)");
  }
}

function ringBell() {
  if (!bell || !ctx) { hudUI.say("Press Start first", "bad", 1500); return; }
  if (bell.state !== "idle") return;
  bell.ring(ctx.getOutputTimestamp().contextTime);
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
        pool.noteOn({ channel: entry.idx + 10, midi: 60, baseNote: 60, buffer: drums[entry.ln.drum],
          velocity: e.velocity * 0.85, when: e.time, destination: mixer.lane(entry.ln.name),
          settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }) });
      }
    }
    if (!songDone()) stageIdx++;
    applyStage();
    hudUI.say(`Locked in! ✨ (${r.judge.matched}/${r.judge.total})`, "good");
    setTimeout(stageMessage, 2500);   // then back to the standing instruction (it used to go blank)
  } else {
    hudUI.say(`Not quite (${r.judge.matched}/${r.judge.total}) — keep playing, it's still listening`, "bad");
  }
}
applyStage();

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
    if (ctx) return;
    ctx = new AudioContext();
    await ctx.resume();
    mixer = createMixer(ctx);
    masterGain = mixer.master;

    drums = await makeDrums(ctx.sampleRate);
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
      channel: entry.idx + 10,
      midi: 60,
      baseNote: 60,
      buffer: drums[entry.ln.drum],
      velocity: e.velocity * 0.85,   // exactly as played, a touch under live play
      when: e.time,
      destination: mixer.lane(entry.ln.name),
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
  const { idx, ln: lane } = entry;

  // timing against this lane's chart notes, loop-wrapped
  const partBeats = currentPart().filter((n) => n.lane === lane.name).map((n) => n.beat);
  const j = partBeats.length
    ? nearestInLoop(partBeats, 4, clock.first, clock.beatDur, press)
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
  }

  // record exactly as played (real timing, real velocity, mistakes and OFF
  // included) — it becomes this lane's ghost from the next pass on
  if (bell) bell.add({ lane: lane.name, t: press, velocity: vel });

  // the player IS the instrument: play immediately, on this lane's channel
  pool.noteOn({
    channel: idx,
    midi: 60,
    baseNote: 60,
    buffer: drums[lane.drum],
    velocity: vel,
    when: ctx.currentTime,
    destination: mixer.lane(lane.name),
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
  return partArrows(currentPart(), (n) => LANE_INDEX[n], clock.first, 4 * clock.beatDur,
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
    stage3d.update(heardNow, buildUpcoming(heardNow), ghostHits);
    tickBell(heardNow);
  } else {
    // before Start: keep the courtyard (and its drums) visible, no arrows
    stage3d.update(0, []);
  }
  drawChart();
  requestAnimationFrame(frame);
}

makeStartButton();
makeCalibrateButton();
window.addEventListener("keydown", onKey);
resize();
window.addEventListener("resize", resize);
requestAnimationFrame(frame);
