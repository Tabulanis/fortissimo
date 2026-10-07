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

// BALLOON GUYS: float in over the bass court, hover, fire rockets that hurt the town; a cannon's shell pops them
{
  const { ARMY } = await import("../src/game/siege.js");
  const s = new Siege({ beatDur: 0.5, rng: seq([0.5]) });
  s.full = true; s.rise = 1; s.startWave("bass");
  let ev = run(s, 0, 4);
  const b = ev.filter((e) => e.type === "spawn" && e.enemy.kind === "balloon").map((e) => e.enemy);
  assert.ok(b.length >= 1 && b[0].alt > 0 && b[0].side === "bass", "a balloon comes over the bass court, up high");
  // a mortar (soldiers) can't target it; a cannon (balloons) can, and aims where it will be
  assert.ok(s.shoot("bass", 4.5, 4, "soldier") === null || s.shoot("bass", 4.5, 4, "soldier").alt === 0, "mortars never aim at balloons");
  const aim = s.shoot("bass", 5.5, 4, "balloon");
  assert.ok(aim && aim.alt > 0 && Math.abs(aim.dist - (b[0].dist - ARMY.balloonSpeed * 1.5)) < 0.05, `a cannon leads it (${aim && aim.dist} vs ${b[0].dist})`);
  ev = run(s, 4.05, 5.7);
  assert.ok(ev.some((e) => e.type === "killed" && e.enemy === b[0]), "the shell pops it");
  // left alone, one hovers and fires rockets: each one lands and hurts the town
  const s2 = new Siege({ beatDur: 0.5, rng: seq([0.5, 0.1, 0.9, 0.3, 0.7]) });
  s2.full = true; s2.startWave("bass");
  ev = run(s2, 0, 3 + (ARMY.start - ARMY.balloonHover) / ARMY.balloonSpeed + 12);
  const fired = ev.filter((e) => e.type === "balloonRocket").length, hits = ev.filter((e) => e.type === "rocketHit");
  assert.ok(fired >= 2 && hits.length >= 1 && hits[0].dmg === ARMY.rocketDmg, `hovering, it fires (${fired}) and the rockets land (${hits.length})`);
  // soldiers come in loose clumps at their own speeds
  const sp = ev.filter((e) => e.type === "spawn" && e.enemy.kind === "soldier").map((e) => e.enemy);
  assert.ok(new Set(sp.map((e) => +e.speed.toFixed(3))).size > 1 || sp.length < 2, "soldiers walk at their own pace");
  assert.ok(sp.length > 0 && sp.every((e) => Math.abs(e.lat) <= ARMY.centre + 1e-9), "bass: the minotaurs come up the middle (owner, 2026-10-07)");
  // treble: the soldiers still keep out of the middle (the cues' lanes)
  const s3 = new Siege({ beatDur: 0.5, rng: seq([0.5, 0.1, 0.9, 0.3, 0.7]) });
  s3.full = true; s3.startWave("treble");
  const sp3 = run(s3, 0, 20).filter((e) => e.type === "spawn" && e.enemy.kind === "soldier").map((e) => e.enemy);
  assert.ok(sp3.length > 0 && sp3.every((e) => Math.abs(e.lat) >= ARMY.sides - 1e-9), "treble: soldiers keep out of the middle");
  assert.ok(s2.enemies.filter((e) => e.alive && e.attacking && e.kind === "soldier").length <= ARMY.wallSlots, "no more than wallSlots at the wall");
  console.log("balloons ok");
}
