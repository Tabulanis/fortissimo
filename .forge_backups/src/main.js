/* main.js — Garden Rhythm beat core.
   Start button -> AudioContext (created inside the click), drums rendered,
   metronome click scheduled ahead of the audio clock, instant kick on F/Space
   with timing judged against the beat grid and mapped to velocity. */

import "./audio/voices.js";
import { makeDrums } from "./audio/drums.js";
import { startClock } from "./audio/clock.js";
import { nearestBeat, velocityFor, label } from "./game/judge.js";

const { VoicePool, VOICE_PRESETS, voiceSettings } = window.HB_VOICES;

const hud = document.querySelector("#hud");
const BPM = 100;

let ctx = null;
let masterGain = null;
let drums = null;
let pool = null;
let clock = null;

function makeStartButton() {
  const btn = document.createElement("button");
  btn.textContent = "Start";
  btn.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:11;font:14px monospace;" +
    "padding:6px 14px;background:#123;color:#8f8;border:1px solid #8f8;cursor:pointer";
  btn.addEventListener("click", async () => {
    if (ctx) return;
    ctx = new AudioContext();
    await ctx.resume();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.8;
    masterGain.connect(ctx.destination);

    drums = await makeDrums(ctx.sampleRate);
    pool = new VoicePool(ctx);

    clock = startClock(ctx, {
      bpm: BPM,
      onBeat: (time, n) => {
        pool.noteOn({
          channel: 0,
          midi: 72,
          baseNote: 60,
          buffer: drums.click,
          velocity: 0.5,
          when: time,
          destination: masterGain,
          settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
        });
      },
    });

    btn.remove();
  });
  document.body.appendChild(btn);
  return btn;
}

function onKey(e) {
  if (e.repeat || !ctx) return;
  if (e.key !== "f" && e.key !== "F" && e.key !== " ") return;
  e.preventDefault();

  // press time on the audio clock, from the event's own timestamp
  const ts = ctx.getOutputTimestamp();
  const press = ts.contextTime + (e.timeStamp - ts.performanceTime) / 1000;
  const j = nearestBeat(clock.beatTimes, press);
  const vel = velocityFor(j.offset);

  pool.noteOn({
    channel: 0,
    midi: 36,
    baseNote: 60,
    buffer: drums.kick,
    velocity: vel,
    when: ctx.currentTime,
    destination: masterGain,
    settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
  });

  const ms = j.offset * 1000;
  hud.textContent =
    `${label(j.offset)}  ${ms >= 0 ? "+" : ""}${ms.toFixed(1)} ms  ` +
    `vel ${vel.toFixed(2)}  lat ${ctx.outputLatency * 1000}.toFixed(1) ms`;
  // fix: template literal above is wrong — build the string properly
  hud.textContent =
    `${label(j.offset)}  ${ms >= 0 ? "+" : ""}${ms.toFixed(1)} ms  ` +
    `vel ${vel.toFixed(2)}  lat ${(ctx.outputLatency * 1000).toFixed(1)} ms`;
}

makeStartButton();
window.addEventListener("keydown", onKey);
