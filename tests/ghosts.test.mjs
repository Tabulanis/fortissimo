import assert from "node:assert";
import { Ghosts } from "../src/game/ghosts.js";

const P = 9.6;    // period, seconds (16 beats at 100 BPM)
const F = 0.5;    // first, seconds

// --- no echo in the pass a recording was played ---------------------------
{
  const g = new Ghosts(P);
  g.record("kick", F + 0 + 1.0, 0.8, F);
  const pass0 = g.events(F, F + P, F);
  assert.deepStrictEqual(pass0, [], "no echo in the pass it was played");
  const pass1 = g.events(F + P, F + 2 * P, F);
  assert.strictEqual(pass1.length, 1, "one kick in pass 1");
  assert.strictEqual(pass1[0].lane, "kick");
  assert.ok(Math.abs(pass1[0].time - (F + P + 1.0)) < 1e-9, "kick at ~ F+P+1.0");
  assert.strictEqual(pass1[0].velocity, 0.8);
}

// --- every hit of a pass is kept, exact positions, time order -------------
{
  const g = new Ghosts(P);
  g.record("kick", F + 0 + 1.0, 0.8, F);     // pass 0, pos 1.0
  g.record("kick", F + 0 + 2.5, 0.9, F);     // pass 0, pos 2.5
  g.record("kick", F + 0 + 4.037, 1.0, F);   // pass 0, pos 4.037 (off-grid)
  const pass1 = g.events(F + P, F + 2 * P, F);
  assert.strictEqual(pass1.length, 3, "all three kicks replay in pass 1");
  const pos = pass1.map((e) => e.time - F - P);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(pos[i] - [1.0, 2.5, 4.037][i]) < 1e-9, `position ${i} exact, time order`);
  }
  assert.deepStrictEqual(pass1.map((e) => e.velocity), [0.8, 0.9, 1.0]);
}

// --- the old take keeps playing during the replacing pass -------------------
{
  const g = new Ghosts(P);
  g.record("kick", F + 1.0, 0.8, F);         // take A: pass 0, pos 1.0
  g.record("kick", F + 2 * P + 3.0, 0.9, F); // take B: pass 2, pos 3.0
  const pass2 = g.events(F + 2 * P, F + 3 * P, F);
  const kicks2 = pass2.filter((e) => e.lane === "kick");
  assert.strictEqual(kicks2.length, 1, "old take still plays during pass 2");
  assert.ok(Math.abs(kicks2[0].time - (F + 2 * P + 1.0)) < 1e-9, "pos 1.0 in pass 2");
  const pass3 = g.events(F + 3 * P, F + 4 * P, F);
  const kicks3 = pass3.filter((e) => e.lane === "kick");
  assert.strictEqual(kicks3.length, 1, "new take only, from pass 3 on");
  assert.ok(Math.abs(kicks3[0].time - (F + 3 * P + 3.0)) < 1e-9, "pos 3.0 in pass 3");
  assert.strictEqual(kicks3[0].velocity, 0.9);
}

// --- an untouched lane's ghost outlives its replacers ------------------------
{
  const g = new Ghosts(P);
  g.record("hat", F + 3.0, 0.6, F);          // hat: pass 0, pos 3.0, only take
  g.record("kick", F + 1.0, 0.8, F);
  g.record("kick", F + 2 * P + 3.0, 0.9, F);
  const pass3 = g.events(F + 3 * P, F + 4 * P, F);
  const hats = pass3.filter((e) => e.lane === "hat");
  assert.strictEqual(hats.length, 1, "hat recorded only in pass 0 still plays in pass 3");
  assert.ok(Math.abs(hats[0].time - (F + 3 * P + 3.0)) < 1e-9, "hat at pos 3.0");
  assert.strictEqual(hats[0].velocity, 0.6);
}

// --- exact positions, never snapped ----------------------------------------
{
  const g = new Ghosts(P);
  g.record("snare", F + 1.037, 0.7, F);
  const ev = g.events(F + P, F + 2 * P, F);
  assert.strictEqual(ev.length, 1);
  assert.ok(Math.abs((ev[0].time - F - P) - 1.037) < 1e-9,
    "off-grid pos 1.037 comes back as exactly 1.037");
}

// --- lanes getter and clear --------------------------------------------------
{
  const g = new Ghosts(P);
  assert.deepStrictEqual(g.lanes, [], "no lanes before any record");
  g.record("kick", F + 1.0, 0.8, F);
  g.record("hat", F + 2.0, 0.6, F);
  assert.deepStrictEqual([...g.lanes].sort(), ["hat", "kick"]);
  g.clear();
  assert.deepStrictEqual(g.lanes, [], "lanes empty after clear");
  assert.deepStrictEqual(g.events(F, F + 3 * P, F), [], "no events after clear");
}

console.log("ghosts: all passed");
