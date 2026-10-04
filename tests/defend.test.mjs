// defend.js — THE STREAM: notes come in song order, a window always in flight; keep rules; layers
import assert from "node:assert/strict";
import { Defend, STREAM } from "../src/game/defend.js";

const seq = (v) => { let i = 0; return () => v[i++ % v.length]; };
// a 2-bar song (8 beats): kick on every beat, snare on 1 and 3 of each bar, hats on every half beat
const SONG = { bars: 2, notes: [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ lane: "kick", beat: b })),
  ...[1, 3, 5, 7].map((b) => ({ lane: "snare", beat: b })),
  ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5].map((b) => ({ lane: "hat", beat: b })),
  ...[0, 2, 4, 6].map((b) => ({ lane: "bass 1", beat: b })), ...[1, 3, 5, 7].map((b) => ({ lane: "bass 2", beat: b })),
  ...[0, 4].map((b) => ({ lane: "treble 1", beat: b })),
] };
const mk = (o = {}) => { const d = new Defend(SONG, o); d.windowBeats = 5; d.graceBeats = 0.3; d.missFrom = 0; return d; };
const at = (d, now) => { d.now = now; d.tick(); return d.offered(); };
const ids = (ns) => ns.map((n) => n.lane[0] + n.at);

// EASY: the window streams the backbone (kick + snare) in song order, one at a time, a beat apart
{
  const d = mk({ keep: "any" });
  const w = at(d, 0);
  assert.ok(w.length >= 2 && w.every((n) => ["kick", "snare", "hat"].includes(n.lane)), `first pass: the groove — kick, snare, hat (${ids(w)})`);
  assert.ok(new Set(w.map((n) => n.lane)).size >= 3, `it FLOWS between instruments, not kick kick kick (${ids(w)})`);
  assert.ok(w.every((n, i) => !i || n.at - w[i - 1].at >= 2 - 1e-9), "Easy: two beats apart, never two together");
  assert.ok(w.every((n) => n.at >= 0 && n.at <= 5), "only what's inside the window");
  // the stream keeps coming: time moves on, the window slides, nothing waits for a hit
  const w2 = at(d, 3);
  assert.ok(w2[w2.length - 1].at > w[w.length - 1].at, "the window slides forward");
  // a hit locks on the spot (Easy keeps whatever you hit)
  const n0 = w2[0];
  assert.equal(d.hit(n0.id), "lock");
  assert.ok(d.locked.has(n0.id) && d.drain().some((e) => e.type === "lock"));
  // what went by unhit is a MISS, once, and the stream carries on past it
  const gone = at(d, w2[1].at + 1).length;   // the next streamed note went by
  const ev = d.drain(), misses = ev.filter((e) => e.type === "miss");
  assert.ok(misses.length >= 1, "misses reported");
  d.tick(); assert.equal(d.drain().filter((e) => e.type === "miss").length, 0, "each occurrence missed once only");
  assert.ok(gone > 0, "still streaming after misses");
  // the missed ones come back next pass; the second pass still streams
  const w3 = at(d, w2[1].at + 5);
  assert.ok(w3.length > 0 && w3.some((n) => n.at > w2[1].at + 1), "the stream keeps going");
}
// PASSES reveal the song: once kick + snare are locked, the next pass is the hats
{
  const d = mk({ keep: "any" });
  for (const n of d.notes) if (n.lane === "kick" || n.lane === "snare") d.locked.add(n.id);
  const w = at(d, 0);
  assert.ok(w.length && w.every((n) => n.lane === "hat"), `then the hats (${ids(w)})`);
  assert.ok(w.every((n, i) => !i || n.at - w[i - 1].at >= 2 - 1e-9), "Easy thins the hats to one every two beats");
}
// MEDIUM: half-beat density, up to two together; a pattern of 3 in a row locks; a break keeps a random half
{
  const d = mk({ lockSize: 3, keep: "half", rng: seq([0.2, 0.9]) });
  const w = at(d, 0);
  assert.ok(w.every((n, i) => !i || n.at - w[i - 1].at >= 0.5 - 1e-9 || Math.abs(n.at - w[i - 1].at) < 1e-9), "Medium: half a beat");
  const counts = {}; for (const n of w) counts[n.at] = (counts[n.at] || 0) + 1;
  assert.ok(Object.values(counts).every((c) => c <= 2), "never more than two together (two hands)");
  assert.equal(d.hit(w[0].id), "progress"); assert.equal(d.hit(w[1].id), "progress");
  assert.ok(d.drain().some((e) => e.type === "progress" && e.hit === 2 && e.of === 3));
  assert.equal(d.hit(w[2].id), "lock", "three in a row lock");
  assert.ok(d.locked.has(w[0].id) && d.locked.has(w[1].id) && d.locked.has(w[2].id));
  d.drain();
  // two more hits, then a miss: the pattern breaks, a random half of the two kept (rng: 0.2 yes, 0.9 no)
  const [a, b] = [w[3], w[4]];
  d.hit(a.id); d.hit(b.id);
  at(d, b.at + 2);   // the next one goes by
  const ev = d.drain();
  assert.ok(ev.some((e) => e.type === "chunkFail" && e.why === "missed"));
  assert.ok(d.locked.has(a.id) && !d.locked.has(b.id), "one of the two kept");
}
// HARD: everything as written, a break keeps nothing; Expert (Infinity): the whole section in one go
{
  const d = mk({ lockSize: 3, keep: "none" });
  const w = at(d, 0);
  assert.ok(w.some((n) => n.lane === "hat") && w.some((n) => n.lane === "kick"), "Hard streams every layer at once");
  d.hit(w[0].id); d.hit(w[1].id);
  d.stray();
  assert.equal(d.locked.size, 0, "a wrong note: nothing kept");
  assert.ok(d.drain().some((e) => e.type === "chunkFail" && e.why === "wrong note"));
  const x = new Defend({ bars: 1, notes: [0, 1, 2].map((b) => ({ lane: "kick", beat: b })) }, { lockSize: Infinity, keep: "none" });
  x.windowBeats = 4; x.graceBeats = 0.3; x.now = 0;
  for (const n of x.offered()) x.hit(n.id);
  assert.ok(x.locked.size === 3 && x.done, "all three in a row: the section locks (and with nothing after it, the song is done)");
}
// sections: lockAll (harness) walks drums -> bass -> treble -> done; the bars stream strong beats first
{
  const d = mk({ keep: "any" });
  d.lockAll(); assert.equal(d.section, "bass");
  const w = at(d, 0);
  assert.ok(w.length && w.every((n) => n.lane.startsWith("bass")), "bass notes now");
  d.lockAll(); d.lockAll();
  assert.ok(d.done && d.drain().filter((e) => e.type === "sectionDone").length === 3);
  assert.deepEqual(Object.keys(STREAM), ["any", "half", "none"]);
}
console.log("defend ok (stream)");

// FILLERS ARE THE SONG: a long wait is filled with the section's own notes — locked ones replayed
// (bonus: score, lock nothing), or notes from a later layer brought forward (real: they lock)
{
  // the groove layer is just two kicks (a 12-beat wait); the crash (a later layer) sits on the odd beats
  const song = { bars: 4, notes: [...[1, 3, 5, 7, 9, 11, 13, 15].map((b) => ({ lane: "crash", beat: b, midi: 49 })), { lane: "kick", beat: 0 }, { lane: "kick", beat: 12 }] };
  const d = new Defend(song, { keep: "any" }); d.windowBeats = 16; d.graceBeats = 0.3; d.missFrom = 0; d.now = 0;
  // the long wait is filled by the crash, brought forward (real)
  let w = d.offered();
  assert.ok(w.some((n) => n.lane === "kick") && w.some((n) => n.lane === "crash" && !n.bonus), `the song fills its own gaps (${ids(w)})`);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].at - w[i - 1].at <= STREAM.any.maxGap + 1e-9, "never a long wait");
  assert.ok(w.every((n) => !n.bonus), "nothing locked yet: the fillers are real notes, brought forward");
  // once the crash is locked, its notes come back as replays (bonus) in the gaps — same lane, same pitch
  const d2 = new Defend(song, { keep: "any" }); d2.windowBeats = 16; d2.graceBeats = 0.3; d2.missFrom = 0; d2.now = 0;
  for (const n of d2.notes) if (n.lane === "crash") d2.locked.add(n.id);
  w = d2.offered();
  const bonus = w.filter((n) => n.bonus);
  assert.ok(bonus.length >= 2 && bonus.every((n) => n.lane === "crash" && n.midi === 49), `the band's notes replayed as fillers (${ids(w)})`);
  assert.ok(bonus.every((n, i) => !i || n.at - bonus[i - 1].at >= 2 - 1e-9), "fillers never closer than 2 beats");
  assert.equal(d2.hit(bonus[0].id), "bonus");
  assert.ok(d2.drain().some((e) => e.type === "bonusHit") && d2.progress("drums") === 8 / 10, "a replay scores but locks nothing");
  // a missed replay doesn't break a Medium pattern
  const m = new Defend(song, { lockSize: 2, keep: "half" }); m.windowBeats = 16; m.graceBeats = 0.3; m.missFrom = 0; m.now = 0;
  for (const n of m.notes) if (n.lane === "crash") m.locked.add(n.id);
  const mw = m.offered(), real = mw.find((n) => !n.bonus), rep = mw.find((n) => n.bonus && n.at > real.at);
  m.hit(real.id); m.drain(); m.now = rep.at + 1; m.tick();
  assert.ok(!m.drain().some((e) => e.type === "chunkFail"), "a missed replay leaves the pattern alone");
  console.log("fillers ok");
}

// PHRASES at the guns: three on the bottom row, SWITCH, three on the top — both rows from the start
{
  const song = { bars: 4, notes: [] };
  for (let b = 0; b < 16; b++) { song.notes.push({ lane: `bass ${1 + (b % 8)}`, beat: b }); song.notes.push({ lane: `bass ${9 + (b % 8)}`, beat: b + 0.5 }); }
  const d = new Defend(song, { keep: "any" });   // no drum notes: it starts at bass
  d.windowBeats = 16; d.graceBeats = 0.3; d.missFrom = 0; d.now = 0;
  const w = d.offered(), rows = w.map((n) => (+n.lane.split(" ")[1] >= 9 ? "T" : "B")).join("");
  assert.ok(/^(BBBTTT)+/.test(rows), `three bottom, three top, from the start (${rows})`);
  console.log("phrases ok");
}
