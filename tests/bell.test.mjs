import assert from "node:assert";
import { judgeMeasure, Bell } from "../src/game/bell.js";
import { Loops } from "../src/game/loops.js";
import { DIFFICULTY } from "../src/game/difficulty.js";

const F = 0.5;    // first, seconds
const B = 1.0;    // beatDur, seconds (60 bpm)
const BAR = 4;    // bar = 4 seconds

const part = [
  { lane: "kick", beat: 0 },
  { lane: "kick", beat: 1 },
  { lane: "kick", beat: 2 },
  { lane: "kick", beat: 3 },
];

// --- judgeMeasure: ratio -----------------------------------------------------
{
  const hits = [
    { lane: "kick", t: 0.0, velocity: 1.0 },
    { lane: "kick", t: 1.0, velocity: 1.0 },
    { lane: "kick", t: 2.0, velocity: 1.0 },
  ];
  const easy = judgeMeasure(hits, part, 0, B, DIFFICULTY.easy);
  assert.strictEqual(easy.pass, true, "3 of 4 matches passes easy (0.75)");
  const normal = judgeMeasure(hits, part, 0, B, DIFFICULTY.normal);
  assert.strictEqual(normal.pass, false, "3 of 4 matches fails normal (1.00)");
  assert.strictEqual(easy.matched, 3);
  assert.strictEqual(easy.total, 4);
}

// --- judgeMeasure: window ----------------------------------------------------
{
  // a hit just past Normal's box, but inside Easy's (boxes come from DIFFICULTY)
  const late = (DIFFICULTY.normal.window + DIFFICULTY.easy.window) / 2;
  const hits = [{ lane: "kick", t: late, velocity: 1.0 }];
  const easy = judgeMeasure(hits, part, 0, B, DIFFICULTY.easy);
  assert.strictEqual(easy.matched, 1, `a ${late} s late hit counts on easy (${DIFFICULTY.easy.window})`);
  const normal = judgeMeasure(hits, part, 0, B, DIFFICULTY.normal);
  assert.strictEqual(normal.matched, 0, `a ${late} s late hit does not count on normal (${DIFFICULTY.normal.window})`);
  assert.strictEqual(normal.extras, 1, "the unmatched hit is an extra on normal");
}

// --- judgeMeasure: extras ----------------------------------------------------
{
  const hits = [
    { lane: "kick", t: 0.0, velocity: 1.0 },
    { lane: "kick", t: 1.0, velocity: 1.0 },
    { lane: "kick", t: 2.0, velocity: 1.0 },
    { lane: "kick", t: 3.0, velocity: 1.0 },
    { lane: "kick", t: 3.5, velocity: 1.0 }, // extra kick between beats
  ];
  const easy = judgeMeasure(hits, part, 0, B, DIFFICULTY.easy);
  assert.strictEqual(easy.extras, 1, "the off-beat kick is one extra");
  assert.strictEqual(easy.pass, true, "1 extra is within easy's limit of 2");
  const normal = judgeMeasure(hits, part, 0, B, DIFFICULTY.normal);
  assert.strictEqual(normal.extras, 1);
  assert.strictEqual(normal.pass, true, "1 extra is within normal's limit of 1");
  const hard = judgeMeasure(hits, part, 0, B, DIFFICULTY.hard);
  assert.strictEqual(hard.pass, false, "1 extra exceeds hard's limit of 0");
  const twoExtra = hits.concat([{ lane: "kick", t: 2.5, velocity: 1.0 }, { lane: "kick", t: 3.5, velocity: 1.0 }]);
  const easy2 = judgeMeasure(twoExtra, part, 0, B, DIFFICULTY.easy);
  assert.strictEqual(easy2.extras, 3, "two more off-beat kicks make three extras");
  assert.strictEqual(easy2.pass, false, "3 extras exceeds even easy's limit of 2");
}

// --- Bell: ring -> armed, next bar line after now + 0.05 ---------------------
{
  const bell = new Bell({ first: F, beatDur: B });
  assert.strictEqual(bell.state, "idle");
  bell.ring(1.0);
  assert.strictEqual(bell.state, "armed");
  assert.strictEqual(bell.recordStart, 4.5, "recording starts at the first bar line strictly after 1.05");
  assert.strictEqual(bell.recordEnd, 8.5);
  bell.ring(2.0); // ringing while armed does nothing
  assert.strictEqual(bell.state, "armed");
  assert.strictEqual(bell.recordStart, 4.5);
  bell.cancel();
  assert.strictEqual(bell.state, "idle");
}

// --- Bell: an early beat-1 hit belongs to the measure; an early hit for the
// NEXT bar's beat 1 does not (tested by behaviour, not internals) -----------
{
  const bell = new Bell({ first: F, beatDur: B });
  bell.ring(1.0);
  bell.add({ lane: "kick", t: 4.47, velocity: 1.0 });   // arrives while still "armed"
  bell.add({ lane: "kick", t: 8.47, velocity: 1.0 });   // early for the next bar
  const r = bell.tick(8.5 + DIFFICULTY.easy.window + 0.001, { part, diff: DIFFICULTY.easy, free: true });
  assert.ok(r && r.locked, "free mode locks");
  assert.strictEqual(r.layer.hits.length, 1, "only the 4.47 kick is in this measure");
  assert.ok(Math.abs(r.layer.hits[0].pos - (-0.03)) < 1e-9, "raw position kept (-0.03)");
}

// --- Bell: on a FAILED measure, the next bar's early beat-1 hit survives ---
{
  const bell = new Bell({ first: F, beatDur: B });
  bell.ring(1.0);
  bell.add({ lane: "kick", t: 8.47, velocity: 1.0 });   // only an early hit for bar 2's beat 1
  const r1 = bell.tick(8.5 + DIFFICULTY.normal.window + 0.001, { part, diff: DIFFICULTY.normal, free: false });
  assert.ok(r1 && !r1.locked, "empty measure fails");
  for (const t of [9.5, 10.5, 11.5]) bell.add({ lane: "kick", t, velocity: 1.0 });
  const r2 = bell.tick(12.5 + DIFFICULTY.normal.window + 0.001, { part, diff: DIFFICULTY.normal, free: false });
  assert.ok(r2 && r2.locked, "the 8.47 kick carried over, so bar 2 has all four beats and locks");
  assert.strictEqual(r2.layer.hits.length, 4);
}

// --- Bell: tick gates on recordEnd + window ----------------------------------
{
  const bell = new Bell({ first: F, beatDur: B });
  bell.ring(1.0);
  bell["__setRecording"](DIFFICULTY.easy.window);
  const early = bell.tick(8.5 - DIFFICULTY.easy.window - 0.001, { part, diff: DIFFICULTY.easy, free: false });
  assert.strictEqual(early, null, "before recordEnd - window the measure is not complete: null");
  assert.strictEqual(bell.state, "recording");
}

// --- Bell: passing measure locks, raw positions, startBar = bar after --------
{
  const bell = new Bell({ first: F, beatDur: B });
  bell.ring(1.0);
  bell["__setRecording"](DIFFICULTY.easy.window);
  bell.add({ lane: "kick", t: 4.53, velocity: 0.9 }, DIFFICULTY.easy.window);
  bell.add({ lane: "kick", t: 5.5, velocity: 0.9 }, DIFFICULTY.easy.window);
  bell.add({ lane: "kick", t: 6.5, velocity: 0.9 }, DIFFICULTY.easy.window);
  bell.add({ lane: "kick", t: 7.5, velocity: 0.9 }, DIFFICULTY.easy.window);
  const r = bell.tick(8.5 + 0.081, { part, diff: DIFFICULTY.easy, free: false });
  assert.strictEqual(r.locked, true, "the passing measure locks");
  assert.strictEqual(r.judge.pass, true);
  assert.strictEqual(r.judge.matched, 4);
  assert.strictEqual(r.layer.startBar, 2, "recorded bar 1 (4.5-8.5) -> loop from bar 2 (8.5): bar k starts at first + k*4");
  assert.strictEqual(r.layer.hits.length, 4);
  assert.ok(Math.abs(r.layer.hits[0].pos - 0.03) < 1e-12, "pos is raw: 4.53 - 4.5 = 0.03, not snapped");
  assert.strictEqual(r.layer.hits[0].velocity, 0.9);
  assert.strictEqual(bell.state, "idle");
}

// --- Bell: failing measure discards and records the next bar -----------------
{
  const bell = new Bell({ first: F, beatDur: B });
  bell.ring(1.0);
  bell["__setRecording"](DIFFICULTY.normal.window);
  bell.add({ lane: "kick", t: 4.5, velocity: 0.9 }, DIFFICULTY.normal.window);
  bell.add({ lane: "kick", t: 5.5, velocity: 0.9 }, DIFFICULTY.normal.window);
  const r = bell.tick(8.5 + 0.051, { part, diff: DIFFICULTY.normal, free: false });
  assert.strictEqual(r.locked, false, "2 of 4 matches fails normal");
  assert.strictEqual(bell.state, "recording", "stays recording");
  assert.strictEqual(bell.recordStart, 8.5, "immediately records the next bar");
  assert.strictEqual(bell._hits.length, 0, "the failed hits are discarded");
  bell.cancel();
}

// --- Bell: free mode passes anything -----------------------------------------
{
  const bell = new Bell({ first: F, beatDur: B });
  bell.ring(1.0);
  bell["__setRecording"](DIFFICULTY.hard.window);
  bell.add({ lane: "kick", t: 4.7, velocity: 0.4 }, DIFFICULTY.hard.window);
  bell.add({ lane: "snare", t: 6.33, velocity: 0.7 }, DIFFICULTY.hard.window);
  const r = bell.tick(8.5 + 0.031, { part, diff: DIFFICULTY.hard, free: true });
  assert.strictEqual(r.locked, true, "free mode locks any measure");
  assert.strictEqual(r.judge.pass, true);
  assert.strictEqual(r.layer.hits.length, 2);
  assert.strictEqual(bell.state, "idle");
}

// --- Loops: layers schedule from their startBar, exact times -----------------
{
  const loops = new Loops(BAR);
  assert.strictEqual(loops.count, 0);
  loops.add({ startBar: 2, hits: [{ lane: "kick", pos: 0.03, velocity: 0.9 }] });
  assert.strictEqual(loops.count, 1);
  const ev = loops.events(F, F + 4 * BAR, F);
  assert.strictEqual(ev.length, 2, "the layer plays from bar 2 on within the window");
  assert.ok(Math.abs(ev[0].time - (F + 2 * BAR + 0.03)) < 1e-9, "first event at 8.53");
  assert.ok(Math.abs(ev[1].time - (F + 3 * BAR + 0.03)) < 1e-9, "second event at 12.53");
  assert.strictEqual(ev[0].velocity, 0.9);
  const before = loops.events(0, 8.5, F);
  assert.strictEqual(before.length, 0, "nothing before the layer's startBar");
  loops.add({ startBar: 2, hits: [{ lane: "snare", pos: 1.0, velocity: 0.6 }] });
  const both = loops.events(F + 2 * BAR, F + 3 * BAR, F);
  assert.strictEqual(both.length, 2, "two layers both play");
  assert.deepStrictEqual(both.map((e) => e.lane).sort(), ["kick", "snare"]);
  loops.clear();
  assert.strictEqual(loops.count, 0);
  assert.strictEqual(loops.events(0, 100, F).length, 0);
}

console.log("bell: all passed");
