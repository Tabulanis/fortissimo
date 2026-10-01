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

// --- replacement: replayed lane replaces its ghost; others are kept -------
{
  const g = new Ghosts(P);
  g.record("kick", F + 1.0, 0.8, F);        // pass 0, pos 1.0
  g.record("hat", F + 3.0, 0.6, F);          // pass 0, pos 3.0
  g.record("kick", F + P + 2.0, 0.9, F);     // pass 1, pos 2.0 -> replaces
  const pass2 = g.events(F + 2 * P, F + 3 * P, F);
  const kicks = pass2.filter((e) => e.lane === "kick");
  const hats = pass2.filter((e) => e.lane === "hat");
  assert.strictEqual(kicks.length, 1, "only the pos-2.0 kick plays in pass 2");
  assert.ok(Math.abs(kicks[0].pos ?? kicks[0].time - (F + 2 * P + 2.0)) < 1e-9
    || Math.abs(kicks[0].time - (F + 2 * P + 2.0)) < 1e-9, "kick at pos 2.0");
  assert.strictEqual(kicks[0].velocity, 0.9, "replaced velocity");
  assert.strictEqual(hats.length, 1, "hat recorded in pass 0 still plays in pass 2");
  assert.ok(Math.abs(hats[0].time - (F + 2 * P + 3.0)) < 1e-9, "hat at pos 3.0");
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
