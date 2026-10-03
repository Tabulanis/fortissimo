import assert from "node:assert";
import { ROUNDS } from "../src/game/stages.js";
import { roundFromProject, songProjectFromRound } from "../src/game/hackbeat.js";
import { lessonParts, periodBars, sectionProgress, backLevel, NOTES_PER_STEP } from "../src/game/lesson.js";

const song = roundFromProject(songProjectFromRound(ROUNDS[0]).project);

// the repeat length of a part
assert.strictEqual(periodBars([{ lane: "kick", beat: 0 }, { lane: "kick", beat: 4 }], 2), 1, "same bar twice = a 1-bar loop");
assert.strictEqual(periodBars([{ lane: "kick", beat: 0 }, { lane: "kick", beat: 5 }], 2), 2, "different bars = the whole 2 bars");
assert.strictEqual(periodBars([{ lane: "kick", beat: 0 }], 2), 2, "only in bar 1 = doesn't repeat");

// every step's pattern, looped to the song's length, rebuilds the song exactly
function rebuilt(parts, bars) {
  const out = [];
  for (const p of parts) for (const n of p.part) {
    if (p.atBar != null) { for (let k = 0; k < bars / p.phraseBars; k++) out.push(`${n.lane}@${(n.beat + 4 * p.atBar + 4 * p.phraseBars * k).toFixed(4)}`); continue; }
    for (let k = 0; k < bars / p.bars; k++) out.push(`${n.lane}@${(n.beat + 4 * p.bars * k).toFixed(4)}`);
  }
  return out.sort();
}
const songKeys = song.notes.map((n) => `${n.lane}@${n.beat.toFixed(4)}`).sort();

// EASY: 4 notes a step at most, each step a short loop; drums, then bass, then treble
{
  const parts = lessonParts(song, NOTES_PER_STEP.easy);
  assert.ok(parts.every((p) => p.part.length <= 4), "<= 4 notes per step");
  assert.ok(parts.every((p) => song.bars % p.bars === 0 && p.part.every((n) => n.beat < 4 * p.bars)), "each step is a loop that divides the song");
  const modes = parts.map((p) => p.mode);
  assert.ok(modes.lastIndexOf("drums") < modes.indexOf("bass") && modes.lastIndexOf("bass") < modes.indexOf("treble"), "drums, bass, treble");
  const order = [...new Set(parts.flatMap((p) => p.instrument.split(" + ")))];
  assert.deepStrictEqual(order.slice(0, 4), ["Bass drum", "Snare", "Hihat", "Crash"], "drums in the owner's order");
  assert.strictEqual(parts[0].instrument, "Bass drum + Snare", "two drums from the start");
  assert.deepStrictEqual(rebuilt(parts, song.bars), songKeys, "nothing lost, nothing added");
  assert.ok(parts.some((p) => p.bars < song.bars), "repeating parts are taught as short loops");
  const kick1 = parts.find((p) => p.instrument.includes("Bass drum")).part.map((n) => n.beat);
  assert.ok(kick1.includes(0), `the kick's first step has the downbeat (${kick1})`);
}

// HARD plays more at once: fewer steps, drums together, still the whole song
{
  const easy = lessonParts(song, NOTES_PER_STEP.easy), hard = lessonParts(song, NOTES_PER_STEP.hard);
  assert.ok(hard.every((p) => p.part.length <= 8));
  assert.ok(hard.length < easy.length, `hard: ${hard.length} steps vs easy ${easy.length}`);
  assert.ok(hard.some((p) => p.mode === "drums" && p.instrument.includes(" + ")), "more than one drum in a step");
  assert.deepStrictEqual(rebuilt(hard, song.bars), songKeys);
}

// EXPERT: every note on the instrument you're at — all drums in one step, each row whole
{
  const ex = lessonParts(song, NOTES_PER_STEP.expert);
  assert.strictEqual(ex.filter((p) => p.mode === "drums").length, 1, "all the drums in one step");
  assert.ok(ex.filter((p) => p.mode !== "drums").every((p) => /(bottom|top)$/.test(p.instrument)), "rows one at a time");
  assert.deepStrictEqual(rebuilt(ex, song.bars), songKeys);
}

// BAR BY BAR (Easy): a busy part that doesn't repeat is learned one bar at a time, and still adds up
{
  const busy = { bars: 2, notes: [0, 1, 2, 3, 4.5, 5.5, 6.5, 7.5].map((beat, i) => ({ lane: i % 2 ? "snare" : "kick", beat, vel: 1 })) };
  const plain = lessonParts(busy, 4), byBar = lessonParts(busy, 4, { barByBar: true });
  assert.ok(plain.every((p) => p.bars === 2), "without it: 2-bar steps");
  assert.ok(byBar.every((p) => p.bars === 1 && p.atBar != null && p.phraseBars === 2), "with it: 1-bar steps, each knowing its place");
  assert.deepStrictEqual(byBar.map((p) => p.atBar), [0, 1]);
  assert.ok(byBar.every((p) => p.part.every((n) => n.beat < 4)), "each step's notes sit in its own 1-bar loop");
  assert.deepStrictEqual(rebuilt(byBar, 2), busy.notes.map((n) => `${n.lane}@${n.beat.toFixed(4)}`).sort(), "and it all adds up to the song");
}

// section progress + the back tracks' level
{
  const parts = lessonParts(song, 4);
  const firstBass = parts.findIndex((p) => p.mode === "bass");
  assert.deepStrictEqual(sectionProgress(parts, 0), { drums: 0, bass: 0, treble: 0 });
  assert.strictEqual(sectionProgress(parts, firstBass).drums, 1, "drums done when the bass starts");
  assert.ok(sectionProgress(parts, 1).drums > 0 && sectionProgress(parts, 1).drums < 1);
  assert.deepStrictEqual(sectionProgress(parts, parts.length), { drums: 1, bass: 1, treble: 1 });
  assert.ok(backLevel(0) > 0.2 && backLevel(0) < 0.5, "quiet but audible from the start");
  assert.ok(backLevel(0.5) > backLevel(0) && backLevel(0.5) < 1, "grows while the section is learned");
  assert.strictEqual(backLevel(1), 1, "fully in when the section is done");
}
console.log("lesson ok");
