import assert from "node:assert";
import { SessionLog } from "../src/game/session.js";
import { Ghosts } from "../src/game/ghosts.js";

const F = 0.5;   // first, seconds
const LAYOUT = { top: ["hat", "snare", "crash"], bottom: ["kick", "tom low", "tom high"] };

// --- three hits incl. an off-grid one at time 1.037 -------------------------
{
  const s = new SessionLog({ bpm: 100, loopBeats: 16, layout: LAYOUT });
  s.add({ lane: "kick", drum: "kick", t: F + 0.0, velocity: 0.9, mode: "drum", label: "HIT" });
  s.add({ lane: "snare", drum: "snare", t: F + 1.037, velocity: 0.6, mode: "drum", label: "EARLY" });
  s.add({ lane: "hat", drum: "hat", t: F + 2.0, velocity: 1.0, mode: "free", label: "FREE" });

  const j = s.toJSON(F, null);

  // the off-grid time survives exactly — relative to first, never snapped
  assert.strictEqual(j.hits.length, 3, "three hits");
  assert.strictEqual(j.hits[1].time, 1.037, "off-grid time 1.037 kept exactly");
  assert.strictEqual(j.hits[0].time, 0.0, "grid time exact");
  assert.strictEqual(j.hits[2].time, 2.0, "third time exact");

  // order preserved
  assert.deepStrictEqual(
    j.hits.map((h) => h.lane),
    ["kick", "snare", "hat"],
    "hits keep their order",
  );
  assert.deepStrictEqual(
    j.hits.map((h) => h.label),
    ["HIT", "EARLY", "FREE"],
    "labels keep their order",
  );

  // format string
  assert.strictEqual(j.format, "garden-rhythm/1");
  assert.strictEqual(j.bpm, 100);
  assert.strictEqual(j.loopBeats, 16);
  assert.ok(typeof j.savedAt === "string" && !Number.isNaN(Date.parse(j.savedAt)),
    "savedAt is an ISO timestamp");
  assert.deepStrictEqual(j.layout, LAYOUT, "layout round-trips");

  // JSON round-trip: stringify then parse gives back an equal object
  const rt = JSON.parse(JSON.stringify(j));
  assert.deepStrictEqual(rt, j, "JSON.stringify/parse round-trips equal");
  assert.strictEqual(rt.hits[1].time, 1.037, "1.037 survives the round-trip");
}

// --- ghosts ride along as plain data ---------------------------------------
{
  const g = new Ghosts(9.6);
  g.record("kick", F + 1.0, 0.8, F);
  g.record("hat", F + 2.5, 0.6, F);

  const s = new SessionLog({ bpm: 100, loopBeats: 16, layout: LAYOUT });
  s.add({ lane: "kick", drum: "kick", t: F + 1.0, velocity: 0.8, mode: "drum", label: "HIT" });

  const j = s.toJSON(F, g);
  assert.deepStrictEqual(j.ghosts, {
    kick: [{ pass: 0, hits: [{ pos: 1.0, velocity: 0.8 }] }],
    hat: [{ pass: 0, hits: [{ pos: 2.5, velocity: 0.6 }] }],
  }, "ghost takes as plain data");
  const rt = JSON.parse(JSON.stringify(j));
  assert.deepStrictEqual(rt.ghosts, j.ghosts, "ghost data round-trips");
}

console.log("session: all passed");
