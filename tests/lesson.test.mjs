import assert from "node:assert";
import { ROUNDS } from "../src/game/stages.js";
import { roundFromProject, songProjectFromRound } from "../src/game/hackbeat.js";
import { lessonParts, sectionProgress, backLevel, NOTES_PER_STEP } from "../src/game/lesson.js";

const song = roundFromProject(songProjectFromRound(ROUNDS[0]).project);

// EASY: 4 notes a step at most; drums one instrument at a time, then bass, then treble
{
  const parts = lessonParts(song, NOTES_PER_STEP.easy);
  assert.ok(parts.every((p) => p.part.length <= 4), "<= 4 notes per step");
  const modes = parts.map((p) => p.mode);
  assert.ok(modes.lastIndexOf("drums") < modes.indexOf("bass") && modes.lastIndexOf("bass") < modes.indexOf("treble"), "drums, bass, treble");
  const instruments = [...new Set(parts.map((p) => p.instrument))];
  assert.deepStrictEqual(instruments, ["Bass drum", "Snare", "Hihat", "Crash", "Bass top", "Bass bottom", "Treble top", "Treble bottom"].filter((i) => instruments.includes(i)).sort((a, b) => instruments.indexOf(a) - instruments.indexOf(b)));
  assert.deepStrictEqual(instruments.slice(0, 4), ["Bass drum", "Snare", "Hihat", "Crash"], "drums one at a time, in the owner's order");
  // each step is an instrument's notes only, as long as the song
  for (const p of parts) assert.ok(p.part.every((n) => p.part[0].lane.split(" ")[0] === n.lane.split(" ")[0]) && p.bars === song.bars);
  // nothing lost, nothing added
  const all = (ps) => ps.flatMap((p) => p.part).map((n) => `${n.lane}@${n.beat}`).sort();
  assert.deepStrictEqual(all(parts), song.notes.map((n) => `${n.lane}@${n.beat}`).sort());
  // the most important first: the kick's first step holds both bars' downbeats
  const kick1 = parts.find((p) => p.instrument === "Bass drum").part.map((n) => n.beat);
  assert.ok(kick1.includes(0) && kick1.includes(4), `kick step 1 has the downbeats (${kick1})`);
}

// HARD plays more at once: 8 a step -> fewer steps, still all the notes
{
  const easy = lessonParts(song, NOTES_PER_STEP.easy), hard = lessonParts(song, NOTES_PER_STEP.hard);
  assert.ok(hard.every((p) => p.part.length <= 8));
  assert.ok(hard.length < easy.length, `hard: ${hard.length} steps vs easy ${easy.length}`);
  assert.ok(hard.some((p) => p.part.length > 4), "hard really plays more than 4 in one go");
}

// section progress + the back tracks' level
{
  const parts = lessonParts(song, 4);
  const firstBass = parts.findIndex((p) => p.mode === "bass");
  assert.deepStrictEqual(sectionProgress(parts, 0), { drums: 0, bass: 0, treble: 0 });
  assert.strictEqual(sectionProgress(parts, firstBass).drums, 1, "drums done when the bass starts");
  assert.ok(sectionProgress(parts, 1).drums > 0 && sectionProgress(parts, 1).drums < 1);
  assert.deepStrictEqual(sectionProgress(parts, parts.length), { drums: 1, bass: 1, treble: 1 });
  assert.strictEqual(backLevel(0), 0);
  assert.ok(backLevel(0.5) > 0 && backLevel(0.5) < 0.5, "fades in partly while the section is learned");
  assert.strictEqual(backLevel(1), 1, "fully in when the section is done");
}
console.log("lesson ok");
