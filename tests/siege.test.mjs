// siege.js: arrows always come; the building shield blocks under its height; the full one has life
import assert from "node:assert/strict";
import { Siege, FLIGHT_S, ARROW_SHIELD_DMG, REUP_AT, arrowDamage } from "../src/game/siege.js";

const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const run = (s, from, to, step = 0.05) => { const ev = []; for (let t = from; t <= to + 1e-9; t += step) { s.tick(t); ev.push(...s.drain()); } return ev; };

// no shield: every arrow gets through, one every 2 beats
{
  const s = new Siege({ miss: 5, beatDur: 0.5, rng: seq([0.5]) });
  const ev = run(s, 0, 10);
  const launched = ev.filter((e) => e.type === "arrow").length, hits = ev.filter((e) => e.type === "arrowHit");
  assert.ok(launched >= 9 && launched <= 10, `an arrow a second (2 beats of 0.5 s): ${launched}`);
  assert.ok(hits.length >= launched - 2, "nothing blocks them");
  assert.equal(hits[0].dmg, arrowDamage(5));
}
// half built: arrows aimed under the rise are zapped, over it get through
{
  const s = new Siege({ beatDur: 0.5, rng: seq([0.2, 0.8]) });
  s.rise = 0.5;
  const ev = run(s, 0, 10);
  const z = ev.filter((e) => e.type === "zapped").length, h = ev.filter((e) => e.type === "arrowHit").length;
  assert.ok(Math.abs(z - h) <= 1 && z > 2, `half and half: ${z} zapped, ${h} through`);
  // an arrow lands FLIGHT_S after it's launched
  const first = ev.find((e) => e.type === "arrow");
  assert.ok(Math.abs(first.landAt - first.launch - FLIGHT_S) < 1e-9);
}
// full: arrows hit the shield's life; at 0 it breaks and arrows reach the town; healing raises it again
{
  const s = new Siege({ beatDur: 0.5, rng: seq([0.9]) });
  s.full = true; s.rise = 1;
  let ev = run(s, 0, 5);
  assert.ok(ev.some((e) => e.type === "shieldHit" && e.dmg === ARROW_SHIELD_DMG) && !ev.some((e) => e.type === "arrowHit"), "the full shield takes them");
  assert.ok(s.hp < 100);
  s.damageShield(1000);
  ev = s.drain();
  assert.ok(s.broken && ev.some((e) => e.type === "shieldBroken"), "it breaks at 0");
  ev = run(s, 5.05, 10);
  assert.ok(ev.some((e) => e.type === "arrowHit"), "broken: arrows reach the town");
  let n = 0; while (s.broken && n < 100) { s.heal(); n++; }
  assert.ok(!s.broken && s.hp >= REUP_AT && s.drain().some((e) => e.type === "shieldBack"), `healed back up after ${n} locks`);
}
console.log("siege ok");

// THE ARMY: soldiers march in and stop at the wall; a shell kills what it lands on; the boss takes hits
{
  const { ARMY } = await import("../src/game/siege.js");
  const s = new Siege({ beatDur: 0.5, rng: seq([0.5]) });
  s.full = true; s.rise = 1; s.paused = false;
  s.startWave("bass");
  let ev = run(s, 0, 1);
  const spawned = ev.filter((e) => e.type === "spawn");
  assert.ok(spawned.length >= 1 && spawned[0].enemy.side === "bass", "soldiers come on the bass side");
  const e = spawned[0].enemy;
  // a shell aimed now lands where the soldier will be
  const at = s.shoot("bass", 2.0, 1.0);
  assert.ok(at && Math.abs(at.dist - (e.dist - ARMY.soldierSpeed * 1.0)) < 0.05, `leads its target: ${at && at.dist} vs ${e.dist}`);
  ev = run(s, 1.05, 2.1);
  assert.ok(ev.some((x) => x.type === "killed" && x.enemy.id === e.id), "the shell kills it");
  // nothing on the other side: a treble gun has no target
  assert.equal(s.shoot("treble", 3, 2), null);
  // left alone, soldiers reach the wall and wear the shield down
  const hp0 = s.hp;
  run(s, 2.1, 2.1 + (ARMY.start - ARMY.wall) / ARMY.soldierSpeed + 3);
  assert.ok(s.enemies.some((x) => x.alive && x.attacking), "they reach the wall");
  assert.ok(s.hp < hp0, `and hit the shield: ${hp0} -> ${s.hp.toFixed(1)}`);
}
{
  const s = new Siege({ beatDur: 0.5, rng: seq([0.5]) });
  s.full = true;
  s.startWave("treble", { bossHp: 3 });
  const boss = s.boss;
  assert.ok(boss && boss.kind === "boss" && boss.hp === 3);
  // shells don't touch it: nothing for a shell down its court but the escort
  assert.equal(s.shoot("treble", 0.5, 0), null, "no escort yet: nothing for a shell to hit");
  run(s, 0, 1.2);
  assert.ok(boss.alive && boss.hp === 3, "shells never hurt the boss");
  // the LIGHTNING GUN does: three bolts
  let ev = [];
  for (let k = 0; k < 3; k++) { s.zapBoss(1); ev.push(...s.drain()); }
  assert.equal(ev.filter((x) => x.type === "bossHit").length, 3, "every bolt hits the boss");
  assert.ok(!boss.alive && ev.some((x) => x.type === "killed" && x.enemy === boss), "three bolts bring it down");
  // locking the last note ends the wave: everyone left falls
  s.startWave("treble", { bossHp: 99 });
  s.endWave();
  assert.ok(s.enemies.every((x) => !x.alive) && s.drain().some((x) => x.type === "killed" && x.enemy.kind === "boss"));
}
console.log("army ok");
