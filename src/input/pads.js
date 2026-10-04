/* pads.js — drum pads and game controllers as drum inputs.

   MIDI (e-kits, pad controllers, anything sending General MIDI drum notes):
     the pad's velocity becomes how hard the drum is hit; each event carries
     its own timestamp, so timing is as exact as the keyboard's.
   Game controllers (standard mapping), polled once per frame — every button
   does ONE thing (owner, 2026-10-03: no doubled-up buttons):
   DRUMS   upper row  LB = hat    Y = snare      RB = crash
           lower row  A = kick    X = tom low    RT = tom high
   BARS    (bass / treble, two rows of 8)
           D-pad (left down right up) + X A B Y = the 8 COLUMNS of guns; the game
           fires whichever gun of the column is due (owner, 2026-10-04: no row
           switch). Hold LT to force the top row, RT the bottom (free play).
           At the BOSS the top row is two crystals: LB = left, RB = right.
   every mode: View = LISTEN (the whole section),
           either thumbstick = look around a little (screen mode)

   Calls back with (laneName, force 0..1, timeStamp in performance.now() ms). */

// General MIDI percussion -> lane
export const GM_DRUMS = {
  35: "kick", 36: "kick",
  37: "snare", 38: "snare", 39: "snare", 40: "snare",
  42: "hat", 44: "hat", 46: "hat",
  49: "crash", 52: "crash", 55: "crash", 57: "crash",
  41: "tom low", 43: "tom low", 45: "tom low",
  47: "tom high", 48: "tom high", 50: "tom high",
};

// standard-mapping gamepad button -> lane (or "hint")
export const PAD_BUTTONS = { 4: "hat", 3: "snare", 5: "crash", 0: "kick", 2: "tom low", 7: "tom high", 8: "hint" };
// melody: standard-mapping button -> column 0..7 (the game picks the row)
export const MELODY_BUTTONS = { 14: 0, 13: 1, 15: 2, 12: 3, 2: 4, 0: 5, 1: 6, 3: 7 };
export const FORCE_TOP = 6, FORCE_BOTTOM = 7;   // LT / RT: force a row
export const HINT_BUTTON = 8;   // View: LISTEN to the whole section, every mode

/** Pure: one MIDI message -> {lane, force} | null */
export function midiToHit(data) {
  const [status, note, vel] = data;
  if ((status & 0xf0) !== 0x90 || !vel) return null;      // note-on with velocity only
  const lane = GM_DRUMS[note];
  return lane ? { lane, force: vel / 127 } : null;
}

export function createPads({ onHit, onStatus, onMelody, onCrystal, onHint, melodyMode = () => false } = {}) {
  const status = { midi: [], pads: [] };
  const look = { x: 0, y: 0 };
  const report = () => onStatus && onStatus(status);

  // --- MIDI
  if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then((access) => {
      const hook = () => {
        status.midi = [];
        for (const input of access.inputs.values()) {
          status.midi.push(input.name);
          input.onmidimessage = (ev) => {
            const h = midiToHit(ev.data);
            if (h && onHit) onHit(h.lane, h.force, ev.timeStamp);
          };
        }
        report();
      };
      hook();
      access.onstatechange = hook;
    }).catch(() => { /* no permission or no MIDI: keyboard still works */ });
  }

  // --- game controllers (polled; the Gamepad API has no events for buttons)
  const was = new Map();   // pad index -> pressed[] from last poll
  return {
    poll() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const names = [];
      look.x = 0; look.y = 0;
      for (const gp of pads) {
        if (!gp) continue;
        names.push(gp.id);
        const prev = was.get(gp.index) || [];
        const now = gp.buttons.map((b) => b.pressed || b.value > 0.5);
        if (melodyMode()) {
          // the guns: D-pad + face buttons = the 8 columns; LT / RT force a row; View listens
          const force = now[FORCE_TOP] ? "top" : now[FORCE_BOTTOM] ? "bottom" : null;
          if (now[4] && !prev[4]) onCrystal && onCrystal("left", performance.now());    // LB / RB: the boss's two crystals
          if (now[5] && !prev[5]) onCrystal && onCrystal("right", performance.now());
          for (const [i, col] of Object.entries(MELODY_BUTTONS)) {
            if (now[i] && !prev[i]) onMelody && onMelody(col, 1, performance.now(), force);
          }
          if (now[HINT_BUTTON] && !prev[HINT_BUTTON]) onHint && onHint();
        } else for (const [i, what] of Object.entries(PAD_BUTTONS)) {
          if (now[i] && !prev[i]) {
            if (what === "hint") onHint && onHint();
            // analogue triggers report how far they're pulled: use it as force
            else onHit && onHit(what, Math.max(0.6, gp.buttons[i].value || 1), performance.now());
          }
        }
        was.set(gp.index, now);
        // thumbsticks: whichever is pushed further, past a small dead zone
        for (const [ax, ay] of [[0, 1], [2, 3]]) {
          const x = gp.axes[ax] || 0, y = gp.axes[ay] || 0;
          const m = Math.hypot(x, y);
          if (m < 0.18 || m <= Math.hypot(look.x, look.y)) continue;
          const k = Math.min(1, (m - 0.18) / 0.82) / m;     // rescale past the dead zone
          look.x = x * k; look.y = -y * k;                   // stick up = look up
        }
      }
      if (names.join("|") !== status.pads.join("|")) { status.pads = names; report(); }
    },
    get status() { return status; },
    /** strongest thumbstick this poll, x right / y up, -1..1 */
    get look() { return look; },
  };
}
