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
 */
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
  }

  /** the full shield is standing (not still building, not broken) */
  get standing() { return this.full && !this.broken; }

  tick(now) {
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

  drain() { const e = this.events; this.events = []; return e; }
}
