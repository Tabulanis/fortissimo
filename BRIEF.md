# Fortissimo (folder GardenRhythm) — project brief

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
- **Difficulty** sets "correct enough" — the lock box — and the starting tempo:
  Easy 3/4 hits within ±120 ms, Normal all within ±85 ms, Hard all within
  ±50 ms, Expert all within ±25 ms (no help: you have to really hit it).
  Widened 2026-10-02 after the sixteenth-note fill wouldn't lock; every box
  stays under half a sixteenth at its tempo.
- **HUD:** ghost bell, lives (what costs a life: decide after playtesting),
  current part, difficulty.
- **Settings:** hit volume, backing volume, difficulty, tempo, key bindings,
  controller. VR mode after the core works.

## Rounds and the three stations (decided 2026-10-02)
- **3 rounds, same arena**, each graded on accuracy (S–D) at its end.
- **Each round: drums -> bass -> treble.** Drum parts build the beat (4 parts);
  then turn RIGHT to the bass, then LEFT to the treble. Melody parts can be
  long takes (any number of bars); the bell records the whole phrase.
- **The arena is a crossroads:** drums court ahead (pool, sunset), bass court
  to the right, treble court to the left, closing wall + gate behind. Archers
  on each court fire at the instrument you face.
- **Bass / treble: 8 bars each, two rows of four.** Bottom row = notes 1–4 =
  D-pad (left, down, right, up); top row = notes 5–8 = X A B Y (left, bottom,
  right, top). Keys A S D F / H J K L. Menu rings the bell during melody.
  Expert (later): the sticks add 2 more notes.
- **Each round has a key + scale**; the 8 bars are that scale's octave.
- Rounds are authored as Hackbeat projects (channels named like the drums,
  plus "bass" / "treble"); see src/game/hackbeat.js.

## WORLDS (decided 2026-10-07)
- Fortissimo has several WORLDS, each with a few levels. This one is **ROME** (the courtyard,
  Roman soldiers, minotaurs, the cyclops, the hydra at sea). Planned: a **VIKING** world, a
  **PIRATE SHIP** world, more later.
- A world owns: its ARENA (scene + its own editor layout), its ENEMIES and BOSSES, its INSTRUMENTS
  (sound banks: drum kits, bass sets, treble sets — a Viking kit and horns are not Rome's), and
  its SONGS (each song file names its world; the level list groups by world).
- The song-maker starts by picking the world, then offers that world's banks; a song plays in
  its world's arena with its world's instruments.
- Build rule: anything world-specific is filed under the world from now on (banks/rome/…,
  layouts per world, songs tagged with world) so a new world is new pieces, not surgery.

## A LEVEL = FOUR ROUNDS (decided 2026-10-07)
- Round 1: drums → guns → boss. Round 2: drums → guns → boss. Round 3: drums → guns → boss.
  Round 4: THE HYDRA — no new music: the player conducts EVERYTHING the three rounds built (all
  their drums, bass and treble) as one piece.
- Rome today (Dope, Fortuna, The Forge, then the hydra) is that shape; every level of every world
  follows it.
- The SONG-MAKER makes a whole LEVEL: write round 1, 2 and 3 (each with drums, bass, treble); the
  hydra round builds itself from them.

## Round 4 — CONDUCTOR MODE at the sea gate (decided 2026-10-06; was "DJ set" for an hour)
- **Rounds 1–3 build the band, round 4 conducts it.** Round 1 = the song's verse, 2 = the
  middle, 3 = the finale; each round locks drums, bass and treble for its movement. Round 4
  turns you around to the gate BEHIND you; what you locked plays on as the band (spirit
  players). You stop playing notes and conduct.
- **The podium: left hand picks a SECTION** (drums / bass / treble), **right hand gives the
  GESTURE:** **cue in**, **cut**, **accent** (a stab on the downbeat), **swell** (hold through
  a bar: crescendo). Timing lives on the BAR LINE, not the beat: a gesture inside the window
  lands clean on the one; outside it the section stumbles in late and dips — you hear it
  (music is the punishment). Three MOVEMENTS (verse / middle / finale) choose what the band
  plays.
- **Everything comes at once, each answering a section:** soldiers break on the drums,
  minotaurs on the bass, the cyclops on the treble + lightning; arrows are stopped by the
  dome only while ALL THREE sections play together — cut one to deal with a threat and the
  dome thins. **The hydra** is the orchestration test: each head falls to an accent on its
  section's downbeat and regrows if that section has been cut too long. All heads down →
  the finale plays itself through with the full band; you keep the pulse with the bell.
  The export is the performance you conducted — your cues, your dynamics.
- **The place — Clash of the Titans:** through the gate, a cove. Sea ahead (the pool's
  reflecting water, scaled up), cliffs closing in on both sides, a dock running out into
  the water with the podium at its end, a ship run up on the beach — the troops pour down
  its gangplank; the hydra rises from the sea. Blocked out in placeholder geometry
  (src/scene/cove.js); his models replace parts as they come (Hydra needs a rigged
  export with clips: rise, bite, hit, death).
- Build order: cove blockout + the back gate opened (DONE) → the three sections answering
  the four gestures on the bar line, the song's own parts as the band, no monsters (is
  conducting fun?) → movements → the real stems from rounds 1–3 → enemies by section → hydra.

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
