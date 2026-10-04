import assert from "node:assert";
import fs from "node:fs";
import { Defend, MIN_GAP_S } from "../src/game/defend.js";
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
  // lock every drum: the section moves on
  while (d.section === "drums") d.hit(d.offered()[0].id);
  assert.strictEqual(d.section, "bass");
  const ev = d.drain();
  assert.ok(ev.some((e) => e.type === "sectionDone" && e.section === "drums"));
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

// GROUPS with a KEEP rule (owner, 2026-10-03): Easy keeps whatever you hit, Medium a random
// half of it when the pattern breaks, Hard nothing without the whole pattern
{
  const song = { bars: 2, notes: [0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ lane: "kick", beat: b })) };
  const seq = (v) => { let i = 0; return () => v[i++ % v.length]; };
  // EASY: any order, each hit locks; one hit and a miss = the group is done, the next starts after it
  let d = new Defend(song, { lockSize: 3, keep: "any" });
  let g = d.offered().map((n) => n.beat);
  assert.deepStrictEqual(g, [0, 1, 2]);
  assert.strictEqual(d.hit(d.offered()[1].id), "lock", "the middle one first: fine on Easy");
  assert.ok(d.locked.size === 1);
  d.miss(d.offered()[0].id);
  d.nowBeat = 2.5;   // time moves on: the next group is what comes round after the lead
  assert.deepStrictEqual(d.offered().map((n) => n.beat), [3, 4, 5], "got one, missed one: on to the next group");
  // nothing hit: the same group comes round again
  d.miss(d.offered()[0].id);
  assert.deepStrictEqual(d.offered().map((n) => n.beat), [3, 4, 5], "none hit: it comes round again");
  // left-behind notes come back when the section wraps round
  for (const n of d.offered()) d.hit(n.id);
  d.nowBeat = 5.5;
  assert.deepStrictEqual(d.offered().map((n) => n.beat), [0, 6, 7], "then on, wrapping round to the missed one");
  // MEDIUM: in order; the pattern breaks after two hits — a random half of them lock
  d = new Defend(song, { lockSize: 3, keep: "half", rng: seq([0.2, 0.9]) });
  const [a, b, c] = d.offered();
  assert.strictEqual(d.hit(a.id), "progress"); assert.strictEqual(d.hit(b.id), "progress");
  d.miss(c.id);
  assert.ok(d.locked.has(a.id) && !d.locked.has(b.id), "one of the two kept (rng 0.2 yes, 0.9 no)");
  assert.deepStrictEqual(d.offered().map((n) => n.beat), [1, 2], "the rest of the group comes round again");
  // a whole pattern locks it all
  for (const n of d.offered()) d.hit(n.id);
  assert.ok(d.locked.has(b.id) && d.locked.has(c.id));
  // HARD: two hits then a miss = nothing kept
  d = new Defend(song, { lockSize: 3, keep: "none" });
  const h = d.offered();
  d.hit(h[0].id); d.hit(h[1].id); d.miss(h[2].id);
  assert.strictEqual(d.locked.size, 0, "Hard keeps nothing without the whole pattern");
  console.log("groups ok");
}

// EASY groups never ask for two hits at once (owner: 1, 2, 3); Medium may, at most two
{
  const song = { bars: 1, notes: [0, 1, 2, 3].flatMap((b) => [{ lane: "kick", beat: b }, { lane: "hat", beat: b }, { lane: "snare", beat: b + 0.5 }]) };
  const d = new Defend(song, { lockSize: 3, keep: "any" });
  const beats = d.offered().map((n) => n.beat);
  assert.strictEqual(new Set(beats).size, beats.length, `Easy: no two at once (${beats})`);
  const m = new Defend(song, { lockSize: 3, keep: "half" });
  const counts = {}; for (const n of m.offered()) counts[n.beat] = (counts[n.beat] || 0) + 1;
  assert.ok(Object.values(counts).every((c) => c <= 2), "Medium: never more than two at once");
  console.log("one-at-a-time ok");
}
