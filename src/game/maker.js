/* maker.js — the SONG-MAKER's core, pure (owner, 2026-10-07: "Create" on the main menu — pick the
   instruments, write the level by PLAYING, quantize for loose players — "so any idiot can do it").
   No audio, no DOM: tested in node.

   TIMING HELP (what the screen calls it): how hard a played note is pulled onto the grid.
     HELP.off      as played
     HELP.little   eighths, pulled halfway (keeps the feel)
     HELP.tidy     sixteenths, all the way          ← the default
     HELP.robot    eighths, all the way
   A Take is everything played in one pass of the loop on one part; the Draft holds the takes per
   part (drums / bass / treble), layered, with undo and "start this part again". Notes are stored
   AS PLAYED plus the help they were made with, so turning the help up afterwards re-tidies them.

   The draft turns into a Fortissimo song file ({ format: "fortissimo-song", ... }) with
   draftToSong(): lanes, sounds from the chosen kit / sets, pitches from the chosen mood. */

export const HELP = {
  off:    { label: "Off",      grid: 0,   strength: 0 },
  little: { label: "A little", grid: 0.5, strength: 0.5 },
  tidy:   { label: "Tidy",     grid: 0.25, strength: 1 },
  robot:  { label: "Robot",    grid: 0.5, strength: 1 },
};
export const DEFAULT_HELP = "tidy";

/** where a beat lands with this help (beats, within a loop of `loopBeats`) */
export function tidyBeat(beat, help = DEFAULT_HELP, loopBeats = 16) {
  const h = HELP[help] || HELP[DEFAULT_HELP];
  if (!h.grid || !h.strength) return wrap(beat, loopBeats);
  const snapped = Math.round(beat / h.grid) * h.grid;
  return wrap(beat + (snapped - beat) * h.strength, loopBeats);
}
const wrap = (b, L) => { const r = ((b % L) + L) % L; return Math.abs(r - L) < 1e-6 ? 0 : +r.toFixed(6); };

// MOODS (what the screen calls keys/scales): semitone steps from the root, eight bars a row
export const MOODS = {
  bright:     { label: "Bright",     scale: "major",      steps: [0, 2, 4, 5, 7, 9, 11, 12] },
  dark:       { label: "Dark",       scale: "minor",      steps: [0, 2, 3, 5, 7, 8, 10, 12] },
  mysterious: { label: "Mysterious", scale: "phrygian",   steps: [0, 1, 3, 5, 7, 8, 10, 12] },
  heroic:     { label: "Heroic",     scale: "mixolydian", steps: [0, 2, 4, 5, 7, 9, 10, 12] },
};
export const TEMPOS = { slow: { label: "Slow", bpm: 72 }, medium: { label: "Medium", bpm: 92 }, fast: { label: "Fast", bpm: 116 } };

export const PARTS = ["drums", "bass", "treble"];
export const DRUMS = ["hat", "snare", "crash", "kick", "tom low", "tom high"];
/** the lanes a part plays: drums by name, bass / treble bars 1..16 (row 1 = bars 1-8, row 2 = 9-16) */
export const lanesOf = (part) => (part === "drums" ? DRUMS : Array.from({ length: 16 }, (_, i) => `${part} ${i + 1}`));

export class Draft {
  constructor({ world = "rome", bars = 4, tempo = "medium", mood = "bright", rootMidi = 48, help = DEFAULT_HELP, kit = null, bass = null, treble = null } = {}) {
    Object.assign(this, { world, bars, tempo, mood, rootMidi, help, kit, bass, treble });
    this.takes = { drums: [], bass: [], treble: [] };   // part -> [ [{ lane, played, vel }] ], oldest first
    this.open = null;                                    // the take being recorded: { part, notes }
  }
  get loopBeats() { return this.bars * 4; }
  get bpm() { return (TEMPOS[this.tempo] || TEMPOS.medium).bpm; }

  /** start a pass on a part (each pass of the loop is a take; an empty one is dropped) */
  beginTake(part) { this.closeTake(); this.open = { part, notes: [] }; }
  /** a note played at `beat` (loop beats, as played) */
  play(lane, beat, vel = 1) {
    if (!this.open) return null;
    const n = { lane, played: +beat.toFixed(4), vel: Math.max(0.05, Math.min(1, vel)) };
    this.open.notes.push(n); return { ...n, beat: tidyBeat(n.played, this.help, this.loopBeats) };
  }
  closeTake() {
    if (this.open && this.open.notes.length) this.takes[this.open.part].push(this.open.notes);
    this.open = null;
  }
  undo(part) { this.closeTake(); return this.takes[part].pop() || null; }
  clear(part) { this.closeTake(); this.takes[part] = []; }
  setHelp(help) { if (HELP[help]) this.help = help; }

  /** every note of a part, tidied with the CURRENT help; two hits on the same lane and step merge (the louder wins) */
  notes(part, { closedOnly = false } = {}) {   // closedOnly: what the loop plays back (the pass being played is heard live)
    const all = [...this.takes[part].flat(), ...(!closedOnly && this.open && this.open.part === part ? this.open.notes : [])];
    const out = new Map();
    for (const n of all) {
      const beat = tidyBeat(n.played, this.help, this.loopBeats), key = `${n.lane}@${beat.toFixed(3)}`;
      const prev = out.get(key); if (!prev || n.vel > prev.vel) out.set(key, { lane: n.lane, beat, vel: n.vel });
    }
    return [...out.values()].sort((a, b) => a.beat - b.beat || a.lane.localeCompare(b.lane));
  }
  noteCount() { return PARTS.reduce((s, p) => s + this.notes(p).length, 0); }
}

/** the pitch a bar plays: bars 1-8 are the mood's octave from the root, bars 9-16 the octave above */
export function barMidi(bar, mood, rootMidi) {
  const steps = (MOODS[mood] || MOODS.bright).steps;
  return rootMidi + steps[(bar - 1) % 8] + (bar > 8 ? 12 : 0);
}

/** a STARTER BEAT (so nobody faces an empty loop): kick on 1 and 3, snare on 2 and 4, hat on the eighths */
export function starterBeat(bars = 4) {
  const notes = [];
  for (let b = 0; b < bars * 4; b++) {
    notes.push({ lane: b % 2 === 0 ? "kick" : "snare", played: b, vel: 0.9 });
    notes.push({ lane: "hat", played: b, vel: 0.6 }, { lane: "hat", played: b + 0.5, vel: 0.45 });
  }
  return notes;
}

/** a STARTER for any part (the any-idiot button: "Give me a starter"), as notes to add as one take.
 *  drums: starterBeat · bass: one note a beat walking 1-1-5-5-6-6-4-4 · treble: a 1-3-5-8 arpeggio on the eighths (bars 1-8 only) */
export function starterPart(part, bars = 4) {
  if (part === "drums") return starterBeat(bars);
  const notes = [];
  if (part === "bass") {
    const walk = [1, 1, 5, 5, 6, 6, 4, 4];
    for (let b = 0; b < bars * 4; b++) notes.push({ lane: `bass ${walk[Math.floor(b / 2) % 8]}`, played: b, vel: 0.85 });
  } else {
    const arp = [1, 3, 5, 8];
    for (let e = 0; e < bars * 8; e++) notes.push({ lane: `treble ${arp[e % 4]}`, played: e / 2, vel: e % 2 ? 0.55 : 0.75 });
  }
  return notes;
}
/** the lanes the RECORD screen offers: treble's top row (bars 9-16) is the boss's crystals in play, so a made song writes bars 1-8 */
export const recordLanes = (part) => (part === "treble" ? lanesOf("treble").slice(0, 8) : lanesOf(part));

// SOUND SHAPING (owner, 2026-10-13: "we need to be able to choose and set reverb and tone etc. on the instrument the player is selecting"):
// one setting per PART (drums / bass / treble) for the whole level, written into every track of that part as the game's own effects chain
// (hbchain.js: volume, EQ, echo send, reverb send — the same chain Hackbeat songs play through)
export const MIX_DEFAULT = { reverb: 0.2, tone: 0, volume: 1, echo: 0 };
export function partFx(m = MIX_DEFAULT) {
  const t = Math.max(-1, Math.min(1, m.tone ?? 0));   // -1 dark … +1 bright
  return { nudge: 0, vol: m.volume ?? 1, pan: 0, eq: { low: t < 0 ? -t * 4 : -t * 3, mid: t < 0 ? t * 3 : 0, high: t * 11 },
    dist: { on: false, drive: 0.4 }, crush: { on: false, bits: 8 }, chorus: { on: false, rate: 1.5, depth: 0.01, mix: 0.5 },
    delay: { on: true, send: 0.6 * (m.echo ?? 0) }, reverb: { on: true, send: 0.9 * (m.reverb ?? 0) }, filter: { on: false, type: "lowpass", freq: 2000, q: 1 } };
}
const partOfTrack = (t) => (t < 6 ? "drums" : t < 22 ? "bass" : "treble");   // the order draftToSong gives tracks: 6 drums, 16 bass bars, 16 treble bars

/** the finished draft as a Fortissimo song file (the same shape the game loads: roundfiles.js); mix: { drums, bass, treble } sound settings */
export function draftToSong(draft, { name, title, banks, mix = null }) {
  const kit = banks.drums.find((k) => k.id === draft.kit) || banks.drums[0];
  const setOf = (part) => banks[part].find((b) => b.id === draft[part]) || banks[part][0];
  const sounds = {};
  // every lane its OWN track: the game plays samples mono per track, so a shared one would cut each note off with the next
  let track = 0;
  for (const d of DRUMS) sounds[d] = { path: kit.sounds[d], note: 60, track: track++ };
  for (const part of ["bass", "treble"]) {
    const set = setOf(part), base = part === "bass" ? draft.rootMidi : draft.rootMidi + 24;
    for (let bar = 1; bar <= 16; bar++) sounds[`${part} ${bar}`] = { path: set.sample, note: 60 + barMidi(bar, draft.mood, base) - set.root, track: track++ };
  }
  const notes = PARTS.flatMap((p) => draft.notes(p).map((n) => ({ lane: n.lane, beat: n.beat, vel: +n.vel.toFixed(3), midi: sounds[n.lane].note })));
  return {
    format: "fortissimo-song", version: 1, world: draft.world, name, title, swing: 0,
    bpm: draft.bpm, bars: draft.bars, notes, sounds, back: { drums: [], bass: [], treble: [] },
    tracks: Array.from({ length: track }, (_, t) => ({ name: partOfTrack(t), fx: partFx((mix && mix[partOfTrack(t)]) || MIX_DEFAULT) })),
    fxBus: { reverbDecay: 2.6, delayTime: Math.round((60 / draft.bpm) * 0.75 * 1000) / 1000, delayFb: 0.32 }, masterVol: 1,
    ...(mix ? { mix } : {}),
    made: { kit: kit.id, bass: setOf("bass").id, treble: setOf("treble").id, mood: draft.mood, tempo: draft.tempo, help: draft.help },
  };
}

/** A LEVEL (owner, 2026-10-07): rounds 1-3 (each drums -> guns -> boss), then round 4, the HYDRA, conducted
 *  over all the music of rounds 1-3. The level file names its three round songs; round 4 is derived from them
 *  (each section of the hydra round = that part of every round, in order).
 *  -> { format: "fortissimo-level", version: 1, name, title, world, rounds: [file, file, file], hydra: { from: [1, 2, 3] } } */
export function makeLevel(songs, { name, title, files }) {
  if (songs.length !== 3 || files.length !== 3) throw new Error("a level is three rounds, then the hydra");
  return { format: "fortissimo-level", version: 1, name, title, world: songs[0].world, rounds: files,
    hydra: { from: [1, 2, 3], bpm: songs[0].bpm, bars: songs[0].bars } };
}
/** what's still missing before a round can be saved (empty = ready): every part needs at least one note */
export function missingParts(draft) { return PARTS.filter((p) => draft.notes(p).length === 0); }
/** parts that will make a THIN fight (a section lasts as long as its notes do — his design): fewer than `min` notes */
export const THIN = 16;
export function thinParts(draft, min = THIN) { return PARTS.filter((p) => { const n = draft.notes(p).length; return n > 0 && n < min; }); }
/** a file-safe name from the title the player typed */
export const slugOf = (t) => (String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-level").slice(0, 40);
