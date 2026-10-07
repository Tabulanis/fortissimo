import { test } from "node:test";
import assert from "node:assert/strict";
import { Conductor, SECTIONS } from "../src/game/conductor.js";

test("all three sections start playing at a base level", () => {
  const c = new Conductor();
  for (const k of SECTIONS) assert.ok(c.level(k, 0) > 0.5);
  assert.equal(c.playing(0), 3);
});

test("a cut inside the window lands exactly on the bar line and silences the section", () => {
  const c = new Conductor({ beatsPerBar: 4, window: 0.5 });
  const ev = c.cut("bass", 7.7);           // bar 2 is at beat 8: 0.3 early
  assert.equal(ev.clean, true); assert.equal(ev.bar, 2); assert.equal(ev.at, 8);
  assert.ok(c.level("bass", 7.9) > 0.5, "still playing before the bar");
  assert.equal(c.level("bass", 8.5), 0, "silent after the bar");
  assert.equal(c.playing(9), 2);
});

test("a gesture outside the window is LATE: it lands where given and the section dips for a beat", () => {
  const c = new Conductor({ beatsPerBar: 4, window: 0.5, dip: 0.6 });
  const ev = c.cue("treble", 9.2);         // 1.2 after bar 2: late
  assert.equal(ev.clean, false); assert.equal(ev.at, 9.2);
  const during = c.level("treble", 9.5), after = c.level("treble", 10.5);
  assert.ok(during < after * 0.5, `dipped ${during} vs ${after}`);
});

test("an accent on the downbeat surges above the base for a beat, then settles", () => {
  const c = new Conductor();
  const base = c.level("drums", 0);
  c.accent("drums", 16.1);
  assert.ok(c.level("drums", 16.15) > base + 0.2, "surge");
  assert.ok(Math.abs(c.level("drums", 18) - base) < 0.01, "settled");
});

test("a swell climbs to full over two bars; release holds the level reached", () => {
  const c = new Conductor({ swellBars: 2 });
  c.swell("bass", 12);
  const mid = c.level("bass", 16), top = c.level("bass", 20);
  assert.ok(mid > 0.7 && mid < 1, `climbing ${mid}`); assert.equal(top, 1);
  c.release("bass", 16);
  assert.ok(Math.abs(c.level("bass", 19) - mid) < 0.02, "held where released");
});

test("a cut section stays cut until cued back in", () => {
  const c = new Conductor();
  c.cut("drums", 4); assert.equal(c.isOn("drums"), false); assert.equal(c.level("drums", 6), 0);
  c.cue("drums", 8); assert.equal(c.isOn("drums"), true); assert.ok(c.level("drums", 9) > 0.5);
});
