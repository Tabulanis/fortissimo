import { test } from "node:test";
import assert from "node:assert/strict";
import { HydraFight } from "../src/game/hydrafight.js";

const ALL = { drums: true, bass: true, treble: true };
const types = (evs) => evs.map((e) => e.type);

test("a head rears on an even bar and strikes on the next unless countered", () => {
  const f = new HydraFight();
  assert.deepEqual(types(f.bar(0, ALL)), ["rear"]);
  assert.equal(f.rearing.head, 0); assert.equal(f.rearing.strikeBar, 1);
  const s = f.bar(1, ALL);
  assert.deepEqual(types(s), ["strike"]); assert.equal(s[0].dome, true); assert.equal(f.life, 94);   // the dome halves it
});
test("no dome (a section cut): the full bite", () => {
  const f = new HydraFight(); f.bar(0, ALL);
  f.bar(1, { drums: true, bass: false, treble: true }); assert.equal(f.life, 88);
});
test("a clean accent on its section, landing on the strike bar, hits it and cancels the strike", () => {
  const f = new HydraFight(); f.bar(0, ALL);
  assert.deepEqual(f.gesture({ kind: "accent", section: "bass", clean: true, bar: 1 }), []);      // wrong section
  assert.deepEqual(f.gesture({ kind: "accent", section: "drums", clean: false, bar: 1 }), []);    // late
  assert.deepEqual(f.gesture({ kind: "accent", section: "drums", clean: true, bar: 2 }), []);     // wrong bar
  assert.deepEqual(types(f.gesture({ kind: "accent", section: "drums", clean: true, bar: 1 })), ["hit"]);
  assert.deepEqual(types(f.bar(1, ALL)), []); assert.equal(f.life, 100);
});
test("three hits drop a head; the movement moves on; all three down wins", () => {
  const f = new HydraFight(); let n = 0;
  const kill = () => { const evs = f.bar(n, ALL); const r = evs.find((e) => e.type === "rear"); n++;
    const g = f.gesture({ kind: "accent", section: f.heads[r.head].section, clean: true, bar: n }); f.bar(n, ALL); n++; return g; };
  const all = []; for (let k = 0; k < 9; k++) all.push(...kill());
  assert.equal(all.filter((e) => e.type === "down").length, 3);
  assert.ok(f.won); assert.equal(f.movement, 2); assert.equal(f.life, 100);
});
test("a downed head regrows when its section is cut for 4 bars", () => {
  const f = new HydraFight({ hp: 1 }); f.bar(0, ALL);
  f.gesture({ kind: "accent", section: "drums", clean: true, bar: 1 }); assert.ok(f.heads[0].down); assert.equal(f.movement, 1);
  const cut = { drums: false, bass: true, treble: true };
  let evs = []; for (let b = 1; b <= 4; b++) evs.push(...f.bar(b, cut));
  assert.ok(evs.some((e) => e.type === "regrow" && e.head === 0)); assert.ok(!f.heads[0].down);
  assert.equal(f.movement, 1);   // the music never goes back
});
test("life 0 loses", () => {
  const f = new HydraFight({ life: 12 }); f.bar(0, ALL);
  assert.deepEqual(types(f.bar(1, { drums: false, bass: true, treble: true })), ["strike", "lost"]); assert.ok(f.over);
});
