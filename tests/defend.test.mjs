import assert from "node:assert";
import fs from "node:fs";
import { Defend, townDamage, MIN_GAP_S } from "../src/game/defend.js";
import { roundFromProject } from "../src/game/hackbeat.js";

const n = (lane, beat) => ({ lane, beat });
const song = { bars: 1, notes: [n("kick", 0), n("snare", 1), n("kick", 2), n("snare", 3), n("hat", 0.5), n("bass 1", 0), n("bass 10", 2), n("treble 2", 1)] };

// lock size 1 (Easy): the most important notes, spaced out; any one hit locks on the spot
{
  const d = new Defend(song, { lockSize: 1, beatDur: 0.75 });
  const off = d.offered();
  assert.ok(off.every((x) => x.section === "drums"), "drums first");
  for (let i = 1; i < off.length; i++) assert.ok((off[i].beat - off[i - 1].beat) * 0.75 >= MIN_GAP_S - 1e-6, "spaced at least a second apart");
  assert.ok(off.some((x) => x.beat === 0), "the downbeat comes first");
  assert.strictEqual(d.hit(off[0].id), "lock");
  assert.ok(d.locked.has(off[0].id));
  assert.ok(d.drain().some((e) => e.type === "lock"));
  // lock every drum: the section moves on and the drums' part of the shield goes up
  while (d.section === "drums") d.hit(d.offered()[0].id);
  assert.strictEqual(d.section, "bass");
  assert.deepStrictEqual(d.shield(), ["drums"]);
  const ev = d.drain();
  assert.ok(ev.some((e) => e.type === "shield" && e.part === "drums") && ev.some((e) => e.type === "sectionDone" && e.section === "drums"));
}

// lock size 1: a miss moves on to a different note (the pace stays steady); the missed one comes back later
{
  const d = new Defend(song, { lockSize: 1, beatDur: 0.75 });
  const first = d.offered()[0];
  d.miss(first.id);
  const next = d.offered()[0];
  assert.notStrictEqual(next.id, first.id, "a different note after a miss");
  assert.ok(!d.locked.has(first.id) && d.unlocked().some((n) => n.id === first.id), "the missed one is still to do");
}

// lock size 3: the next three in order — all three on one pass, in order, lock together
{
  const d = new Defend(song, { lockSize: 3, beatDur: 0.5 });
  const c = d.offered();
  assert.deepStrictEqual(c.map((x) => x.beat), [0, 0.5, 1], "the first three notes of the drums, in song order");
  assert.strictEqual(d.hit(c[0].id), "progress");
  assert.strictEqual(d.hit(c[2].id), "wrong", "out of order resets the group");
  assert.strictEqual(d.chunkProgress.hit, 0);
  assert.ok(d.drain().some((e) => e.type === "chunkFail"));
  d.hit(c[0].id); d.hit(c[1].id);
  d.miss(c[2].id);
  assert.strictEqual(d.chunkProgress.hit, 0, "a miss resets the group too");
  d.hit(c[0].id); d.hit(c[1].id);
  assert.strictEqual(d.hit(c[2].id), "lock");
  assert.ok(c.every((x) => d.locked.has(x.id)));
}

// lock size Infinity: the whole section in one go
{
  const d = new Defend(song, { lockSize: Infinity, beatDur: 0.5 });
  assert.strictEqual(d.offered().length, 5, "every drum note");
}

// the shield takes a third off the town's damage per part
assert.strictEqual(townDamage(6, 0), 6);
assert.strictEqual(townDamage(6, 1), 4);
assert.strictEqual(townDamage(6, 3), 0);

// a whole real song: every note can be locked, sections go drums -> bass -> treble
{
  const dope = roundFromProject(JSON.parse(fs.readFileSync("../Hackbeat/projects/Dope.json", "utf8")));
  for (const size of [1, 3, 8, Infinity]) {
    const d = new Defend(dope, { lockSize: size, beatDur: 0.75 });
    const order = [];
    let guard = 0;
    while (!d.done && guard++ < 5000) { if (!order.includes(d.section)) order.push(d.section); const o = d.offered(); for (const x of o) d.hit(x.id); }
    assert.ok(d.done, `size ${size}: the whole song locks`);
    assert.strictEqual(d.locked.size, dope.notes.length);
    assert.deepStrictEqual(order, ["drums", "bass", "treble"]);
  }
}
console.log("defend ok");
