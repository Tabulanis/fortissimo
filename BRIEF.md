# Garden Rhythm — project brief (working title)

A rhythm game where **you are the instrument**. Your key press makes the
sound, at the moment you press it. On time = the note lands where it belongs,
full strength. Off time = it lands where you played it, quieter. The song is
literally what you played. The garden shows how the band is doing.

## The core loop
1. **You play** — notes on screen are the sheet music (what to play); the
   sound is yours, fired instantly on key-down.
2. **Timing shapes the sound** — volume slides down smoothly with timing
   error; no hard hit/miss cliff. Off-beat notes should still sound musical
   (ghost-note-like), weak rather than ugly.
3. **Ghost loops** — a phrase you play (4 or 8 bars) keeps playing back as a
   layer under you, mistakes and all. You can play over a lane to replace its
   ghost. Ghosts sit quieter than live playing. Cap of 4–6 layers.
4. **The garden is the band** — each ghost loop is a plant that keeps singing
   your part. Zombies eat ghosts: a lost lane goes silent. You hear the hole
   before you see it. One heartbeat (kick or click) never drops out, so a
   player can always find the beat and recover.
5. **Your garden is your song** — export is the stack of ghosts you kept alive.

## Layout (drum-mode demo)
- Two highways: **TOP** and **BOTTOM**, each **2–5 lanes** (configurable).
  Up to 10 notes on screen at once.
- Assumption to confirm: top notes travel down to a hit line, bottom notes
  travel up to a hit line, both hit lines near the middle. Keys: top lanes
  `Q W E R T`, bottom lanes `Z X C V B` (configurable — many keyboards drop
  some 3–4-key combinations, so test the chosen keys together).

## Modes
- **Drum** — the prototype. Kick / snare / hat family across the lanes.
- **Freestyle** — no sheet music, no zombies; you + instruments + ghost loops.
- **Record** — freestyle that saves.
- **Notes (instrument) mode** — TO FIGURE OUT. Each lane a real instrument;
  harmonies when lanes coincide.
- **Vocals** — TO FIGURE OUT. Its own small project: mic input latency needs its
  own calibration, room noise and speaker feedback, pitch.

## Export
- **Impulse Tracker (.it)** — samples + note patterns, opens in OpenMPT /
  Schism Tracker. Off-beat timing kept with the note-delay effect, loudness in
  the volume column. Synth voices must be rendered to samples at export.

## Stack (both halves already on this box)
- **Music:** Web Audio, from Hackbeat's `static/voices.js` (`window.HB_VOICES`:
  Voice, VoicePool, VOICE_PRESETS, 24-voice cap, ADSR, velocity→brightness).
  Voices play AudioBuffers; starter drums are synthesized into buffers.
- **Picture:** Three.js r170 + Vite 6, from Penpal (`~/penpal/src/game/`:
  world, actor, figure, viewport, torch, vhs, dust, textures, exposure).
  Penpal is a commercial project — if this game ever goes public, those parts
  go with it.
- **New code:** the thin game layer — lanes, input, timing, garden state.

## Architecture rule
Web Audio owns timing, sound, scoring, ghosts, export. Three.js only reflects
what the audio engine reports each frame. Audio says the word; the garden reacts.

## Timing rules (these decide whether ±50 ms means anything)
- Schedule on the **AudioContext clock** with a lookahead scheduler, never on
  setTimeout/setInterval timing.
- **Sound fires on key-down immediately** — never quantized, never queued.
- **Judge the press by the event's own timestamp** (`event.timeStamp`, mapped
  to the audio clock via `audioContext.getOutputTimestamp()`), not by when the
  handler ran.
- **Latency calibration**: a tap-along-to-the-click screen measures the setup's
  offset and subtracts it. Wired audio only — Bluetooth (150–300 ms) is
  unplayable for an instrument.
- **Prove timing with numbers**: log every hit's offset from the beat and show
  the spread (a histogram). "Feels tight" is a guess.
- Starting hit window: ±50 ms (tune later; everything is tuned relative to it).

## Build order — each step playable
1. **Beat core** — one lane, audio-clock metronome, synthesized drum, instant
   sound on key-down, timing → loudness, calibration, offset histogram.
2. **Drum mode** — top + bottom highways, 2–5 lanes each.
   *Fun test:* play it with plain boxes. If hearing the band thin out isn't
   already fun, the garden won't save it.
3. **Ghost loops**.
4. **Freestyle + record**.
5. **The garden** (zombies eat ghosts).
6. **.it export**.
7. Notes mode.
8. Vocals.

## House facts
- Lives on Void: `~/aidojo/current/GardenRhythm`. Dev server: Vite on **:5180**
  (Penpal and GET own :5173).
- Private GitHub repo `Tabulanis/garden-rhythm`, branch `main`; commit + push
  per verified step.
