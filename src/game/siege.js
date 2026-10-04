/* siege.js — the enemy's side of the fight (owner, 2026-10-03). Pure: told the time
 * and how the shield stands, it reports what happened.
 *
 * ARROWS rain in on the town the WHOLE time, every ARROW_BEATS beats.
 *   While the shield is still being built (the drums), it stands up to RISE
 *   (0 = nothing, 1 = the top): an arrow aimed at a height under that is zapped,
 *   one over it gets through and hurts you and the town.
 *   Once the shield is FULL it has its own LIFE: arrows hit it instead.
 *   At 0 it BREAKS — down it goes and arrows reach the town again — until
 *   locking notes heals it back to REUP_AT, when it stands again.
 *
 * Times are heard-audio seconds. Events: drain() ->
 *   { type: "arrow", h, launch, landAt, blocked, onShield }   launched (draw it)
 *   { type: "arrowHit", dmg }        got through: you and the town take dmg
 *   { type: "zapped" }               the building shield caught it
 *   { type: "shieldHit", dmg }       the full shield took it
 *   { type: "shieldBroken" } / { type: "shieldBack" }
 *
 * THE ARMY (owner, 2026-10-03), once you're at the guns: bad guys march in from far
 * down the court you face; at the wall they hit the shield (or, broken, the town).
 * Your guns' shells — yours and the band's — land where they aim and blow up
 * everyone close (TABS ragdolls, troops.js draws them).
 *   bass:   soldiers, a steady stream
 *   treble: THE BOSS — huge, slow, lots of life, hits hard at the wall — and an
 *           escort of soldiers. Shells only get the escort: the boss falls to the LIGHTNING
 *           GUN (zapBoss), charged by hitting the crystals; the last treble lock finishes it
 * An enemy: { id, side, kind: "soldier"|"boss", dist (m from the dome's centre,
 * down its court), lat (m across it), hp, alive, attacking }.
 *   { type: "spawn", enemy }   { type: "killed", enemy, by: {dist, lat} }
 *   { type: "bossHit", enemy, hp, of }   { type: "wallHit", enemy, dmg }
 */
export const ARMY = {
  start: 24,            // where they appear (m down the court)
  wall: 4.1,            // where they stop and hit the shield (the dome is 3.4 m)
  soldierSpeed: 1.6,    // m/s (each one 0.75-1.25x of it: a loose mob, not a formation — owner)
  soldierEvery: 1.3,    // s between spawns (bass), 1-3 at a time; the boss's escort comes half as often
  soldierDps: 3,        // shield damage per second, each soldier at the wall
  bossSpeed: 0.22,      // way slower (owner, 2026-10-04): it lumbers, stopping to wreck things on the way
  bossDps: 5,           // play-tested 2026-10-03: at 9 the boss + escort broke the shield and took the town 99 -> 31 against a robot hitting every note
  bossHpPerNote: 2,     // the boss's life: 2 hits per treble note you'll play
  blast: 2.6,           // m: a shell kills soldiers this close
  lanes: 5.2,           // m: how far out to the sides they come
  sides: 2.6,           // m: they keep OUT of the middle (owner, 2026-10-04: the cues come down the middle)
  wallSlots: 6,         // at most this many hack at the wall; the rest hang back behind them
  bossStandoff: 3.5,    // the boss stops this far behind the wall and swings from there
  // BALLOON GUYS (owner, 2026-10-04): float in high over the bass court, hover, and fire rockets
  // at the cannons that hurt the TOWN; the cannons' shells pop them (mortars can't reach)
  balloonEvery: 7, balloonSpeed: 0.8, balloonAlt: 7, balloonHover: 11, rocketEvery: 3.2, rocketFlight: 1.6, rocketDmg: 2,
};
export const ARROW_BEATS = 2;        // one arrow every 2 beats
export const FLIGHT_S = 1.6;         // an arrow's flight (the 3D arrow flies this long)
export const ARROW_SHIELD_DMG = 2;   // what an arrow does to the full shield (of 100)
export const REUP_AT = 40;           // a broken shield stands again once healed to this
export const LOCK_HEAL = 6;          // locking a note heals the shield this much
export const arrowDamage = (miss) => miss * 0.35;   // through the gap: a third of a missed note's cost

export class Siege {
  /** @param {{miss: number, beatDur: number, rng?: () => number}} opts  miss = the run's miss cost (LIFE) */
  constructor({ miss = 5, beatDur = 0.75, rng = Math.random } = {}) {
    this.dmg = arrowDamage(miss);
    this.every = ARROW_BEATS * beatDur;
    this.rng = rng;
    this.rise = 0;          // set by the game: how high the shield is built (0..1)
    this.full = false;      // set by the game: the shield is complete
    this.hp = 100;
    this.broken = false;
    this.next = null;
    this.flying = [];
    this.events = [];
    this.paused = false;    // no arrows (the run is over)
    this.enemies = [];
    this.wave = null;       // { side, kind: "soldiers"|"boss", nextAt }
    this.boss = null;
    this.lastT = null;
    this._id = 0;
    this.shells = [];
  }

  /** the army for a section: "bass" soldiers, or "treble" with the boss (bossHp: its life) */
  startWave(side, { bossHp = 40 } = {}) {
    this.wave = { side, kind: side === "treble" ? "boss" : "soldiers", nextAt: null };
    if (this.wave.kind === "boss") {
      this.boss = this._spawn(side, "boss", 0);
      this.boss.hp = this.boss.of = bossHp;
    }
  }
  /** the section is done: the boss falls and the stragglers with it */
  endWave() {
    for (const e of this.enemies) if (e.alive) this._kill(e, { dist: e.dist, lat: e.lat });
    this.wave = null;
  }
  _spawn(side, kind, lat) {
    const e = { id: ++this._id, side, kind, dist: ARMY.start, lat, hp: 1, alive: true, attacking: false, claimed: 0,
      speed: kind === "boss" ? ARMY.bossSpeed : kind === "balloon" ? ARMY.balloonSpeed : ARMY.soldierSpeed * (0.75 + 0.5 * this.rng()),
      alt: kind === "balloon" ? ARMY.balloonAlt + (this.rng() - 0.5) * 2 : 0, nextRocket: null };
    this.enemies.push(e);
    this.events.push({ type: "spawn", enemy: e });
    return e;
  }
  _kill(e, by) { e.alive = false; this.events.push({ type: "killed", enemy: e, by }); }
  _distAt(e, t, now) { const stop = e.kind === "balloon" ? ARMY.balloonHover : ARMY.wall; return Math.max(stop, e.dist - (e.attacking ? 0 : e.speed) * Math.max(0, t - now)); }

  /**
   * a gun fired down `side`'s court; its shell lands at `landAt` (heard time).
   * kind: what this gun hunts — "soldier" (mortars) or "balloon" (cannons); the boss takes LIGHTNING.
   * Aims at the nearest, leading it.
   * @returns {{dist: number, lat: number, alt: number} | null} where it'll land (null: nothing to shoot)
   */
  shoot(side, landAt, now = this.lastT ?? landAt, kind = "soldier") {
    const live = this.enemies.filter((e) => e.alive && e.side === side && e.kind === kind);
    if (!live.length) return null;
    // the nearest, spreading the fire: each shell already on its way counts as 4 m further
    let best = null, bestD = Infinity;
    for (const e of live) { const d = e.dist + e.claimed * 4; if (d < bestD) { bestD = d; best = e; } }
    best.claimed++;
    const at = { dist: this._distAt(best, landAt, now), lat: best.lat, alt: best.alt };
    this.shells.push({ side, landAt, at, target: best });
    return at;
  }

  /** the full shield is standing (not still building, not broken) */
  get standing() { return this.full && !this.broken; }

  /** the first live balloon (the rockets' source) — for the game's drawing */
  tick(now) {
    this._tickArmy(now);
    if (this.next == null) this.next = now + this.every;
    while (!this.paused && now >= this.next) {
      const h = this.rng(), launch = this.next;
      const onShield = this.standing, blocked = onShield || h < this.rise;
      const a = { h, launch, landAt: launch + FLIGHT_S, blocked, onShield };
      this.flying.push(a);
      this.events.push({ type: "arrow", ...a });
      this.next += this.every;
    }
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const a = this.flying[i];
      if (now < a.landAt) continue;
      this.flying.splice(i, 1);
      if (a.onShield && this.standing) this.damageShield(ARROW_SHIELD_DMG);
      else if (a.onShield) this.events.push({ type: "arrowHit", dmg: this.dmg });   // broke while it flew: it goes through
      else this.events.push(a.blocked ? { type: "zapped" } : { type: "arrowHit", dmg: this.dmg });
    }
  }

  /** the LIGHTNING GUN strikes the boss (owner, 2026-10-04: crystals charge it) */
  zapBoss(n) {
    const b = this.boss;
    if (!b || !b.alive) return false;
    b.hp = Math.max(0, b.hp - n);
    this.events.push({ type: "bossHit", enemy: b, hp: b.hp, of: b.of });
    if (b.hp <= 0) this._kill(b, { dist: b.dist, lat: b.lat });
    return true;
  }

  /** the full shield takes a hit (an arrow, an enemy at the wall) */
  damageShield(n) {
    if (!this.standing) return;
    this.hp = Math.max(0, this.hp - n);
    this.events.push({ type: "shieldHit", dmg: n });
    if (this.hp <= 0) { this.broken = true; this.events.push({ type: "shieldBroken" }); }
  }

  /** locking notes heals the shield (and raises a broken one once it's back to REUP_AT) */
  heal(n = LOCK_HEAL) {
    if (!this.full) return;
    this.hp = Math.min(100, this.hp + n);
    if (this.broken && this.hp >= REUP_AT) { this.broken = false; this.events.push({ type: "shieldBack" }); }
  }

  _tickArmy(now) {
    const dt = this.lastT == null ? 0 : Math.min(0.25, now - this.lastT);
    this.lastT = now;
    const w = this.wave;
    if (w && !this.paused) {
      if (w.nextAt == null) w.nextAt = now + 0.5;
      if (now >= w.nextAt) {
        const n = 1 + Math.floor(this.rng() * 3), side = this.rng() < 0.5 ? -1 : 1;   // a clump of 1-3, loosely together, down one SIDE
        const lat = side * (ARMY.sides + this.rng() * (ARMY.lanes - ARMY.sides));
        for (let i = 0; i < n; i++) { const s = this._spawn(w.side, "soldier", side * Math.max(ARMY.sides, Math.min(ARMY.lanes, Math.abs(lat + (this.rng() - 0.5) * 2)))); s.dist += this.rng() * 2; }
        w.nextAt = now + ARMY.soldierEvery * (w.kind === "boss" ? 2 : 1) * (0.7 + 0.6 * this.rng());
      }
      if (w.side === "bass") {   // the balloon guys, over the bass court
        if (w.nextBalloon == null) w.nextBalloon = now + 3;
        if (now >= w.nextBalloon) { this._spawn("bass", "balloon", (this.rng() < 0.5 ? -1 : 1) * (3.5 + this.rng() * 2.5)); w.nextBalloon = now + ARMY.balloonEvery * (0.7 + 0.6 * this.rng()); }
      }
    }
    let atWall = this.enemies.filter((e) => e.alive && e.attacking && e.kind === "soldier").length;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.kind === "balloon") {   // drifts in, hovers, and fires rockets at the cannons — they hurt the TOWN
        if (e.dist > ARMY.balloonHover) e.dist = Math.max(ARMY.balloonHover, e.dist - e.speed * dt);
        else {
          if (e.nextRocket == null) e.nextRocket = now + 1;
          if (now >= e.nextRocket && !this.paused) { e.nextRocket = now + ARMY.rocketEvery * (0.8 + 0.4 * this.rng()); this.shells.push({ side: e.side, landAt: now + ARMY.rocketFlight, at: null, target: null, rocket: e }); this.events.push({ type: "balloonRocket", enemy: e, landAt: now + ARMY.rocketFlight }); }
        }
        continue;
      }
      if (!e.attacking) {
        // the boss stands off behind; soldiers queue up behind the ones at the wall when it's full
        const stop = e.kind === "boss" ? ARMY.wall + ARMY.bossStandoff : atWall >= ARMY.wallSlots ? ARMY.wall + 2.2 + (e.id % 5) * 0.5 : ARMY.wall;
        if (e.dist > stop) e.dist = Math.max(stop, e.dist - e.speed * dt);
        if (e.dist <= ARMY.wall + 1e-6 || (e.kind === "boss" && e.dist <= stop + 1e-6)) { e.attacking = true; if (e.kind === "soldier") atWall++; }
      } else if (dt > 0) {
        const dmg = (e.kind === "boss" ? ARMY.bossDps : ARMY.soldierDps) * dt;
        if (this.standing) this.damageShield(dmg);
        else this.events.push({ type: "wallHit", enemy: e, dmg: dmg * 0.5 });   // no shield: it reaches the town (half: the town has walls too)
      }
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      if (now < s.landAt) continue;
      this.shells.splice(i, 1);
      if (s.rocket) { this.events.push({ type: "rocketHit", enemy: s.rocket, dmg: ARMY.rocketDmg }); continue; }   // a balloon's rocket lands: the town takes it
      s.target.claimed = Math.max(0, s.target.claimed - 1);
      for (const e of this.enemies) {
        if (!e.alive || e.side !== s.side) continue;
        const d = Math.hypot(e.dist - s.at.dist, e.lat - s.at.lat);
        if (e.kind === "boss") continue;   // shells don't hurt it (owner, 2026-10-04: the lightning gun does)
        if (e.kind === "balloon" && s.target.kind !== "balloon") continue;   // only a shell aimed up there pops one
        if (d <= ARMY.blast) this._kill(e, s.at);
      }
    }
    // the dead are gone from the logic (troops.js keeps their ragdolls a while)
    if (this.enemies.length > 64) this.enemies = this.enemies.filter((e) => e.alive);
  }

  drain() { const e = this.events; this.events = []; return e; }
}
