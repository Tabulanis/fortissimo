/* hydrafight.js — ROUND 4's rules, pure (owner, 2026-10-08: "screw conductor — a full kit and notes, so
   it will be drums AND notes; drums are kinda constant and notes are the hydra attack. So it's hard because
   you gotta do more" + "have them spit acid so the drums shield has to stay up").

   Two hands at once:
     DRUMS (left hand) hold up the SHIELD. Every drum note hit raises it, every one missed drops it; it
       sags a little on its own, so the groove has to keep going.
     ACID  the living heads keep spitting it. A glob landing while the shield is up (≥ SHIELD_HOLDS)
       sizzles off; below that it gets through, burning in proportion to how far down the shield is.
     NOTES (right hand) are the heads' STRIKES — each note belongs to one head. Hit it: parried, and the
       head takes a wound; enough wounds and it goes DOWN. Miss it: the head BITES you.
     WON  all three heads down. LOST  life 0.
   The game decides which head a note belongs to and how many wounds a head can take (its share of the
   song's notes); this only keeps score. Every call returns the events it caused. */
export const SHIELD_HOLDS = 0.5;

export class HydraFight {
  constructor({ hp = [12, 12, 12], life = 100, bite = 2.5, heal = 0.4, acid = 4, shieldUp = 0.05, shieldDown = 0.12, sag = 0.04 } = {}) {   // (10-08 robot: bite 7 / acid 6 killed a 90% player in 19 s — notes come ~4 a second)
    Object.assign(this, { bite, heal, acid, shieldUp, shieldDown, sag, life, lifeMax: life });
    this.heads = hp.map((n) => ({ hp: n, maxHp: n, down: false }));
    this.shield = 1;               // 0..1, starts up
    this.won = false; this.lost = false;
  }
  get over() { return this.won || this.lost; }
  get downCount() { return this.heads.filter((h) => h.down).length; }
  get alive() { return this.heads.map((h, i) => (h.down ? -1 : i)).filter((i) => i >= 0); }
  _clampShield() { this.shield = Math.max(0, Math.min(1, this.shield)); }
  _hurt(n, out) {
    this.life = Math.max(0, this.life - n);
    if (this.life <= 0 && !this.lost) { this.lost = true; out.push({ type: "lost" }); }
  }

  /** a drum note: hit or missed */
  drum(hit) {
    if (this.over) return [];
    this.shield += hit ? this.shieldUp : -this.shieldDown; this._clampShield();
    return [{ type: hit ? "drumHit" : "drumMiss", shield: this.shield }];
  }
  /** time passes (beats): the shield sags on its own */
  tick(beats) { if (!this.over) { this.shield -= this.sag * beats; this._clampShield(); } }

  /** a glob of acid from head i lands */
  acidLands(i) {
    if (this.over) return [];
    if (this.shield >= SHIELD_HOLDS) return [{ type: "acidBlocked", head: i }];
    const out = [{ type: "acidBurn", head: i, dmg: Math.round(this.acid * (1 - this.shield / SHIELD_HOLDS) * 10) / 10 }];
    this._hurt(out[0].dmg, out);
    return out;
  }

  /** head i's strike (a note): parried (hit) or not */
  strike(i, hit) {
    const h = this.heads[i];
    if (this.over || !h || h.down) return [];
    const out = [];
    if (hit) {
      h.hp -= 1; this.life = Math.min(this.lifeMax, this.life + this.heal);   // a parry heals a little: ~90% wins, ~80% slowly sinks
      out.push({ type: "wound", head: i, hp: h.hp });
      if (h.hp <= 0) {
        h.down = true; out.push({ type: "down", head: i });
        if (this.downCount === this.heads.length) { this.won = true; out.push({ type: "won" }); }
      }
    } else {
      out.push({ type: "bite", head: i, dmg: this.bite });
      this._hurt(this.bite, out);
    }
    return out;
  }
}
