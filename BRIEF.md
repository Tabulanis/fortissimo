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

## The look (decided 2026-09-30) — readable at a glance, one meaning per signal
- **3D, first person, Beat Saber-like.** A Chinese courtyard at night (the owner
  builds the environments; the game drops its drums and arrows into them).
- **Drums in front of you, two rows.** Top row = bright sounds (gong, cymbals,
  woodblock); bottom row = deep drums (war drum, small drum, second big drum).
- **Flaming arrows fly in at the drums. The arrows ARE the sheet music.**
  Flame colour = which drum. Distance = when. An approach ring closing on the
  drumhead shows the exact moment.
- **On time: the arrow shatters** (spark + ember burst), full boom.
  **A bit off:** it glances off / cracks, quieter boom.
  **Miss:** it sticks in the drum and smoulders; that beat is silent.
- **Ghost loops = spirit drummers** — translucent echoes playing your past takes.
- **All lighting is fake:** flames, glows, sparks and the light on drumheads are
  additive billboards (camera-facing sprites). No real lights for effects.
- **Environment contract (to write up):** a .glb scene with named markers —
  player position, drum anchors, arrow spawn points. Any environment that has
  the markers just works.
- The garden/zombie idea is superseded by this; ghost loops and the
  music-is-the-punishment rule carry over.

## Progression — the ghost bell (decided 2026-10-01)
- **The bell is one tool everywhere:** ring it (Space, or click it on the HUD)
  -> it ticks with the song like a metronome -> it records the NEXT measure,
  exactly as played -> that measure repeats forever as a ghost.
- **Guided levels (early):** play WITH a backing song. Start with 2 drums, slow
  (e.g. 60 bpm, bass on 1-2-3-4, Easy); only the active part gets arrows.
  Practise, ring the bell; each recorded measure is checked against the part —
  the first measure that is correct enough FOR THE DIFFICULTY becomes the loop;
  failed measures are discarded and it keeps listening. Then two more drums
  appear with the next part. Repeat until the band is complete.
- **Later levels:** the backing thins out — you MAKE the song from your loops.
- **Free mode (unlockable):** bring your kit, set the tempo, play anything, ring
  the bell — any measure is accepted. Pure looper.
- Ghosts replay EXACTLY what the player did (raw timing and loudness).
- **Difficulty** sets "correct enough" (e.g. Easy 3/4 hits within ±80 ms,
  Normal all within ±50 ms, Hard all within ±30 ms) and the starting tempo.
- **HUD:** ghost bell, lives (what costs a life: decide after playtesting),
  current part, difficulty.
- **Settings:** hit volume, backing volume, difficulty, tempo, key bindings,
  controller. VR mode after the core works.

## VR mode (later) — the drum IS the hit box
- A hit = the moment the controller's stick tip ENTERS a drum's hit volume
  (the drumhead). That moment is the press time; auto-correct applies to it
  exactly as on keyboard.
- Loudness = stick speed at contact (real dynamics: ghost notes to slams).
- Per-drum re-trigger lockout of a few tens of ms so one swing hits once.
- Drums must sit within arm's reach for VR (they are 2-3 m away today).

## Auto-correct (built 2026-10-01)
- A toggles; on by default. A hit inside the difficulty's box is RECORDED on
  its exact beat at full strength (free play: nearest eighth); the live sound
  still fires instantly; outside the box it is recorded as played.

## Export — real music, all your own
- `.it` (editable, OpenMPT/Schism) and WAV/MP3 (rendered offline).
- Exports INCLUDE the backing track — free advertising. Stamp every export:
  .it song message + audio title/artist tags credit the game with a link.
- Condition: backing tracks must be music the owner has the right to give away.

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
