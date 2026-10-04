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
 *           escort of soldiers; locking the last treble note brings it down
 * An enemy: { id, side, kind: "soldier"|"boss", dist (m from the dome's centre,
 * down its court), lat (m across it), hp, alive, attacking }.
 *   { type: "spawn", enemy }   { type: "killed", enemy, by: {dist, lat} }
 *   { type: "bossHit", enemy, hp, of }   { type: "wallHit", enemy, dmg }
 */
export const ARMY = {
  start: 24,            // where they appear (m down the court)
  wall: 4.1,            // where they stop and hit the shield (the dome is 3.4 m)
  soldierSpeed: 1.6,    // m/s
  soldierEvery: 2.2,    // s between soldiers (bass); the boss's escort comes half as often
  soldierDps: 3,        // shield damage per second, each soldier at the wall
  bossSpeed: 0.55,
  bossDps: 9,
  bossHpPerNote: 2,     // the boss's life: 2 hits per treble note you'll play
  blast: 2.6,           // m: a shell kills soldiers this close
  lanes: 4.6,           // m either side of the court's middle (some walk past either side of the guns)
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
    const e = { id: ++this._id, side, kind, dist: ARMY.start, lat, hp: 1, alive: true, attacking: false, claimed: 0 };
    this.enemies.push(e);
    this.events.push({ type: "spawn", enemy: e });
    return e;
  }
  _kill(e, by) { e.alive = false; this.events.push({ type: "killed", enemy: e, by }); }
  _distAt(e, t, now) { const speed = e.attacking ? 0 : e.kind === "boss" ? ARMY.bossSpeed : ARMY.soldierSpeed; return Math.max(ARMY.wall, e.dist - speed * Math.max(0, t - now)); }

  /**
   * a gun fired down `side`'s court; its shell lands at `landAt` (heard time).
   * Aims at the enemy nearest the wall (the boss counts), leading it.
   * @returns {{dist: number, lat: number} | null} where it'll land (null: nothing to shoot)
   */
  shoot(side, landAt, now = this.lastT ?? landAt) {
    const live = this.enemies.filter((e) => e.alive && e.side === side);
    if (!live.length) return null;
    // the nearest, spreading the fire: each shell already on its way counts as 4 m further
    let best = null, bestD = Infinity;
    for (const e of live) { const d = e.dist + e.claimed * 4; if (d < bestD) { bestD = d; best = e; } }
    best.claimed++;
    const at = { dist: this._distAt(best, landAt, now), lat: best.lat };
    this.shells.push({ side, landAt, at, target: best });
    return at;
  }

  /** the full shield is standing (not still building, not broken) */
  get standing() { return this.full && !this.broken; }

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
        this._spawn(w.side, "soldier", (this.rng() * 2 - 1) * ARMY.lanes);
        w.nextAt = now + ARMY.soldierEvery * (w.kind === "boss" ? 2 : 1) * (0.7 + 0.6 * this.rng());
      }
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!e.attacking) {
        e.dist -= (e.kind === "boss" ? ARMY.bossSpeed : ARMY.soldierSpeed) * dt;
        if (e.dist <= ARMY.wall) { e.dist = ARMY.wall; e.attacking = true; }
      } else if (dt > 0) {
        const dmg = (e.kind === "boss" ? ARMY.bossDps : ARMY.soldierDps) * dt;
        if (this.standing) this.damageShield(dmg);
        else this.events.push({ type: "wallHit", enemy: e, dmg });   // no shield: it reaches the town
      }
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      if (now < s.landAt) continue;
      this.shells.splice(i, 1);
      s.target.claimed = Math.max(0, s.target.claimed - 1);
      for (const e of this.enemies) {
        if (!e.alive || e.side !== s.side) continue;
        const d = Math.hypot(e.dist - s.at.dist, e.lat - s.at.lat);
        if (e.kind === "boss") {
          if (d > ARMY.blast * 2) continue;   // a big target
          e.hp--;
          this.events.push({ type: "bossHit", enemy: e, hp: e.hp, of: e.of });
          if (e.hp <= 0) this._kill(e, s.at);
        } else if (d <= ARMY.blast) this._kill(e, s.at);
      }
    }
    // the dead are gone from the logic (troops.js keeps their ragdolls a while)
    if (this.enemies.length > 64) this.enemies = this.enemies.filter((e) => e.alive);
  }

  drain() { const e = this.events; this.events = []; return e; }
}
