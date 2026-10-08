import { test } from "node:test";
import assert from "node:assert/strict";
import { HydraFight, SHIELD_HOLDS } from "../src/game/hydrafight.js";
const types = (e) => e.map((x) => x.type);

test("drums hold the shield up: hits raise it, misses and time drop it", () => {
  const f = new HydraFight();
  f.drum(false); f.drum(false); assert.ok(f.shield < 1);
  const was = f.shield; f.drum(true); assert.ok(f.shield > was);
  const before = f.shield; f.tick(4); assert.ok(f.shield < before);
});
test("acid sizzles off a shield that's up, burns through one that's down — more the lower it is", () => {
  const f = new HydraFight();
  assert.deepEqual(types(f.acidLands(0)), ["acidBlocked"]); assert.equal(f.life, 100);
  f.shield = SHIELD_HOLDS / 2; const half = f.acidLands(0)[0].dmg;
  f.shield = 0; const none = f.acidLands(0)[0].dmg;
  assert.ok(half > 0 && none > half);
});
test("a parried strike wounds its head; enough wounds drop it; all three down wins", () => {
  const f = new HydraFight({ hp: [2, 1, 1] });
  assert.deepEqual(types(f.strike(0, true)), ["wound"]);
  assert.deepEqual(types(f.strike(0, true)), ["wound", "down"]);
  assert.deepEqual(f.strike(0, true), []);   // a downed head strikes no more
  f.strike(1, true); assert.deepEqual(types(f.strike(2, true)), ["wound", "down", "won"]); assert.ok(f.won);
  assert.deepEqual(f.alive, []);
});
test("a missed strike bites; life 0 loses", () => {
  const f = new HydraFight({ life: 10, bite: 7 });   // (explicit: the default is gentler)
  assert.deepEqual(types(f.strike(1, false)), ["bite"]); assert.equal(f.life, 3);
  assert.deepEqual(types(f.strike(1, false)), ["bite", "lost"]); assert.ok(f.over);
});
test("parries heal a little: about 90% holds steady, 80% sinks", () => {
  const run = (acc) => { const f = new HydraFight({ hp: [1e6, 1, 1], life: 100 }); f.life = 60;
    for (let k = 0; k < 1000; k++) f.strike(0, (k % 10) >= (1 - acc) * 10); return f.life; };   // misses first in each ten: it ends on a hit
  assert.ok(run(0.9) > 60, `90%: ${run(0.9)}`);
  assert.equal(run(0.8), 0, "80% for 1000 notes: dead");
});
