# Fortissimo — developer notes

Working notes for anyone picking the project up. The README is the public face; this is how the thing is put together.

## Layout

```
src/main.js            the game loop: rounds, judging, the song clock, menus wired together
src/game/              rules with no rendering: run.js (difficulty + modifiers), hydrafight.js (round 4), save.js, roundfiles.js (song files)
src/scene/             the 3D stage (stage3d.js) and its parts: courtyard, cove, sea, pool, fire, stations, defense (the shield), hydra, altar kit, batcher (static gluing), gltf (one model loader)
src/modes/hydra.js     round 4's play mode (5 drums + 5 guns)
src/ui/                menu, settings, hud, results, loading screen, song-maker screens
src/input/pads.js      keyboard / touch / gamepad → lanes
src/dev/               dev-only: level editor, touch controls for it, the ?perf overlay, model viewer
src/app/native.js      what the packaged app needs (back button, wake lock, haptics); no-ops in a browser
public/songs           the songs the game plays (format fortissimo-song v1, listed in songs.json)
public/rounds/samples  the sounds (Opus .ogg with WAV fallback — tools/compress-samples.sh)
public/banks           sound banks for the song-maker
public/models, ktx/, small/   models: originals (high), GPU-compressed (medium + phones), 512 px (lowest)
public/levels/edits.json      the level layout saved by the editor — never reset it
tests/harness/         browser harness pages (dev server only): robots that play rounds, photo checks, measurements
tools/                 release wizard, asset converters, store screenshots, the https door, the Android env
android/, desktop/     Capacitor and Electron shells
```

## Running

- `npm run dev` → http://localhost:5180 (the dev server also saves the editor's layout and the song-maker's songs).
- `npm run build` → `dist/` with every dev page and hook stripped. `npm run check` = checks + a build.
- `npm run release` → the release wizard (version, changelog, web zip, Android, desktop, tag, push). See the header of `tools/release.mjs`.
- Android needs Java 21 and the Android SDK; `tools/env.sh` expects them in the home folder (`~/.local/opt/jdk-21*`, `~/Android/Sdk`). Signing reads `android/keystore.properties` (never committed).
- `tools/https-door.mjs` serves the dev server over HTTPS on :5181 with a local certificate so a phone can install the game as a home-screen app; `/download` serves the newest APK from `out/`.

## Graphics levels

`?quality=high|medium|low|lowest|potato|bare` (or Options → Graphics; Auto measures the device and steps down below 28 fps).
Phones are detected (`PHONE` in main.js) and skip the effects composer. Medium and phones load the KTX2 models. Bare swaps every
material for a flat average colour. Dynamic resolution drops to 60% when the frame runs slow and climbs back.

Measuring: `?perf` shows ms per pass; `tests/harness/_drawcost3.html` counts draw calls at the play spots (note: it totals two frames);
`_passmap.html` splits them by pass; `_occlpot.html` estimates what occlusion culling would save (about 15% — not worth it until the
arenas are rebuilt as rooms).

## Songs

A round is one 4-bar loop the game repeats and layers. A level is three rounds (drums → guns → boss) and the Hydra, which plays the three
as movements. The planned songs are four parts each (intro, verse, prechorus, chorus): the demo project is written by
`tools/compose-fourpart.py` into a Hackbeat project. Importing: the level editor's IMPORT SONG section (dev build only) reads a tracker project from `../Hackbeat/projects`
(`HACKBEAT_DIR` to point elsewhere), turns its first three patterns into rounds 1-3 of a new level, copies the sounds it uses, and saves
it like the song-maker does. Imported and made levels start unlocked. Converter: src/game/hackbeat.js (tests/hackbeat.test.mjs). Every new sound goes
into `public/legal/credits.md` with its licence.

## Modes

The run setup (start menu) has a **Mode**: *Step by step* (the default — the song comes in layers, density by difficulty, `defend.js`
header) or **Full song** (`stream: "all"` in run.js): every note of the chart streams from the first bar, each clean hit locks its note
and locked notes stop coming, so the stream thins as the player learns it. Full song implies full patterns, single notes, keep whatever
you hit, and carries ×1.25 with no single-note penalty. The target cues become short per-note pulses (`stage3d.setCuePulse`) so
overlapping notes read as separate flashes. The HUD label shows `locked n/total`. `tests/harness/_fullsong.html` runs a 70%-accurate
robot through it (66 drum notes: 20 in flight at the start, cleared in ~40 s).

## Round 4, the Hydra (reworked 2026-10-11 after his first play: "so confusing I can't play it")

Cues are the game's own now (src/scene/altarkit.js): one comet per note flying at its target, the target glowing up over 0.3 s to
white-hot on the beat and dark 60 ms after; acid comets (green) at the drums from ONE spitting head, strike comets (orange) at the
guns from the attacking head; big single keys on every target; no ribbons. Balance (src/modes/hydra.js): a head's hit points are
0.45 × its song's melody notes (was 1.5 ×, i.e. 120 parries a head); bite 1.5, acid 2.5, a parry heals 0.8; the first two bars of
each movement are drums only, then the strikes join; a message names the attacking head. Robot (`tests/harness/_hydra.html`): wins
in ~60 s at 83% on the beat with life ~100 — maybe now too kind; tune `hpOf` and the damages from his play.

**Lanes and elements (same day, his picture: "fire, ice and acid from the heads, from the mouth to the drum, a colour per drum, same for
the other side").** Head 1 = fire, 2 = ice, 3 = acid (`ELEMENT` in modes/hydra.js); each target has a persistent lane strip from the
source head's mouth in the TARGET's colour (bright while a shot rides it), the shot looks like the element; the five guns have their
own colours. A head that is a lane source holds still (`hydra.still`) and its mouth glows its element (`hydra.mouthGlow`); the attacker
stands 0.45 back so it never covers the kit; the spit source is the spitter's mouth pushed 3.5 m away from the eye. Necks: 16 bones
(RIG.neckBones), bends scaled by 8/N. Fixed on the way: acid.js's hit burst was 3-5 m across at the drum (a screen-filling green blob
every hit) → 0.6/1.1 m. `tests/harness/_hydrashot.html#at=9,12,15` = quick photos of the round without playing it through.

## NEXT: the gameplay pass (decided with the owner 2026-10-21 — start here)

His verdicts on the "what's fun / what isn't" talk: **A go, B hold off, C agree, D try the middle version, E yes, F yes.** Build in this order:

- **A. One cue everywhere — a runway with a hit ring.** Each target gets a straight, fixed lane; the rocket rides it at constant speed; a ring
  shrinks onto the target and closes exactly on the beat. Same at the courtyard and the altar; the Hydra heads roar over the lanes instead of
  being the lanes. What's there already (stage3d.js): rockets DO fly a fixed path per lane (`SPAWNS[lane]` → `drumFace[lane]`, `pathPoint` =
  straight line + a low parabolic lift `ARC_LIFT`, `APPROACH_S` 4 s, constant speed) — so the geometry is fixed; what's missing is the
  VISIBLE runway and the ring. Old approach rings exist but are hidden (`rings[lane].mesh`, line ~1915; `r.mesh.visible = false` in the cue
  loop ~2645 — the "magic charge" glow replaced them). Bring a big clear ring back, add a faint lane strip per target. The altar kit
  (altarkit.js) draws its own comets + halos: give it the same ring and lanes; its halos are too big (owner) — a third of the size.
- **C. Every clean hit locks, always.** Drop the group / keep rules (defend.js lockSize/keep, run.js lock/keep rows); difficulty = density +
  hit window only. Menu rows go.
- **E. Juice.** Combo counter on screen, a streak sound, Perfect / Great / OK per hit, the band's volume following the streak.
- **D. Pacing (the middle version).** A section moves on after three passes UNLESS the player is still locking new notes in it; what's
  unlocked joins the band (joinBacking already does that) and the song moves on.
- **B. Held off** (teach one thing per song: level 1 drums only, the town/shield/guns introduced over the first songs). Don't build.
- **F.** The Hydra halos smaller; A covers "an obvious way to see the notes coming".
Also raised, not done: watch someone else play it (his nephew) and note where they stall in the first two minutes.

## Checks before a release

- `npm run check` must pass.
- `tools/check-play.sh` — a robot plays round 1 on low, medium and high and must reach the results panel (needs the dev server and the
  photo sink, `tools/sink.py`, on :8899).
- `tools/store-shots.sh` refreshes `store/shots/` after any look change.
- Test on a real phone and a weak tablet; the Bare level has not been seen on real hardware yet.

## Known gaps

- Tutorial first level; a designed results screen; a font pass.
- iOS (needs a Mac to sign); Steam page.
- Placeholder art everywhere a drum-on-red icon shows (`public/app/`, `assets/`, `store/feature-graphic.png`).
- Three shaders still compile late (the shield's, and one material variant on turning to each gun station): one small hitch each.

## Gotchas learned

- A `//` appended mid-line in an automated edit comments out the rest of the line; tests don't catch it.
- The dev server's `device.log` is the ground truth for what a phone did; `?perf` lines land there every 5 s.
- Headless Firefox needs `media.autoplay.default=0` and `media.autoplay.block-webaudio=false` or the audio clock never starts.
- Saving a game file reloads an open page.
- `pgrep -f` matches its own command line.
