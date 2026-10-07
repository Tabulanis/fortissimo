/* hydrafight.js — ROUND 4's rules, pure (BRIEF "Round 4": "each head falls to an accent on its
   section's downbeat and regrows if that section has been cut too long. All heads down → the finale").

   Three heads, one per SECTION (head 0 = drums, 1 = bass, 2 = treble). The fight runs in BARS
   (the game reports every bar line as it passes, with which sections are playing) and in the
   conductor's gestures (conductor.js events, their bar made global by the game).
     REAR    every `rearEvery` bars the next living head (in turn) rears up: it strikes on the NEXT bar line.
     COUNTER a CLEAN accent on that head's section landing on the strike bar: the head is hit (hp - 1)
             and the strike is cancelled. hp 0 = the head goes DOWN.
     STRIKE  not countered: you take `dmg` — halved while all three sections play (the dome).
     REGROW  a head that is down comes back (full hp) once its section has been cut `regrowBars` bars.
     MOVEMENT the band's music: how many heads have ever been down at once (0, 1, 2) — round 1's music,
             then round 2's, then round 3's. It only moves forward.
     WON     all three down at once → the finale. LOST: life 0.
   bar(n, on) and gesture(ev) return events: { type: "rear"|"hit"|"down"|"strike"|"regrow"|"won"|"lost", head, ... } */
export const HEAD_SECTION = ["drums", "bass", "treble"];

export class HydraFight {
  constructor({ hp = 3, rearEvery = 2, regrowBars = 4, dmg = 12, life = 100 } = {}) {
    Object.assign(this, { maxHp: hp, rearEvery, regrowBars, dmg, life, lifeMax: life });
    this.heads = HEAD_SECTION.map((section) => ({ section, hp, down: false }));
    this.cutBars = { drums: 0, bass: 0, treble: 0 };
    this.rearing = null;          // { head, strikeBar }
    this.lastBar = null; this.turn = 0; this.movement = 0;
    this.won = false; this.lost = false;
  }
  get over() { return this.won || this.lost; }
  get downCount() { return this.heads.filter((h) => h.down).length; }

  /** a bar line passed: n = the global bar number, on = { drums, bass, treble } playing (booleans) */
  bar(n, on) {
    if (this.over || n === this.lastBar) return [];
    this.lastBar = n;
    const out = [];
    for (const s of HEAD_SECTION) this.cutBars[s] = on[s] ? 0 : this.cutBars[s] + 1;
    // regrowth
    this.heads.forEach((h, i) => {
      if (h.down && this.cutBars[h.section] >= this.regrowBars) { h.down = false; h.hp = this.maxHp; out.push({ type: "regrow", head: i }); }
    });
    // a strike due on this bar (not countered)
    if (this.rearing && this.rearing.strikeBar === n) {
      const i = this.rearing.head, dome = HEAD_SECTION.every((s) => on[s]);
      const dmg = dome ? Math.round(this.dmg / 2) : this.dmg;
      this.life = Math.max(0, this.life - dmg); this.rearing = null;
      out.push({ type: "strike", head: i, dmg, dome });
      if (this.life <= 0) { this.lost = true; out.push({ type: "lost" }); return out; }
    }
    // the next head rears (it strikes on the next bar line)
    if (!this.rearing && n % this.rearEvery === 0) {
      const alive = this.heads.map((h, i) => (h.down ? -1 : i)).filter((i) => i >= 0);
      if (alive.length) { const i = alive[this.turn++ % alive.length]; this.rearing = { head: i, strikeBar: n + 1 }; out.push({ type: "rear", head: i, strikeBar: n + 1 }); }
    }
    return out;
  }

  /** a conductor gesture { kind, section, clean, bar } (bar = the global bar it landed on) */
  gesture(ev) {
    if (this.over || !ev || ev.kind !== "accent" || !ev.clean || !this.rearing) return [];
    const i = this.rearing.head, h = this.heads[i];
    if (h.section !== ev.section || ev.bar !== this.rearing.strikeBar) return [];
    this.rearing = null; h.hp -= 1;
    const out = [{ type: "hit", head: i, hp: h.hp }];
    if (h.hp <= 0) {
      h.down = true; out.push({ type: "down", head: i });
      this.movement = Math.max(this.movement, Math.min(2, this.downCount));
      if (this.downCount === 3) { this.won = true; out.push({ type: "won" }); }
    }
    return out;
  }
}
