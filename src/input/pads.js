/* pads.js — drum pads and game controllers as drum inputs.

   MIDI (e-kits, pad controllers, anything sending General MIDI drum notes):
     the pad's velocity becomes how hard the drum is hit; each event carries
     its own timestamp, so timing is as exact as the keyboard's.
   Game controllers (standard mapping), polled once per frame:
     upper row  LB = hat    Y = snare      RB = crash
     lower row  LT = kick   A = tom low    RT = tom high
     B = ring the ghost bell

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
export const MIDI_BELL_NOTE = 56;   // cowbell rings the ghost bell

// standard-mapping gamepad button -> lane (or "bell")
export const PAD_BUTTONS = { 4: "hat", 3: "snare", 5: "crash", 6: "kick", 0: "tom low", 7: "tom high", 1: "bell" };

/** Pure: one MIDI message -> {lane, force} | {bell: true} | null */
export function midiToHit(data) {
  const [status, note, vel] = data;
  if ((status & 0xf0) !== 0x90 || !vel) return null;      // note-on with velocity only
  if (note === MIDI_BELL_NOTE) return { bell: true };
  const lane = GM_DRUMS[note];
  return lane ? { lane, force: vel / 127 } : null;
}

export function createPads({ onHit, onBell, onStatus } = {}) {
  const status = { midi: [], pads: [] };
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
            if (!h) return;
            if (h.bell) onBell && onBell();
            else onHit && onHit(h.lane, h.force, ev.timeStamp);
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
      for (const gp of pads) {
        if (!gp) continue;
        names.push(gp.id);
        const prev = was.get(gp.index) || [];
        const now = gp.buttons.map((b) => b.pressed || b.value > 0.5);
        for (const [i, what] of Object.entries(PAD_BUTTONS)) {
          if (now[i] && !prev[i]) {
            if (what === "bell") onBell && onBell();
            // analogue triggers report how far they're pulled: use it as force
            else onHit && onHit(what, Math.max(0.6, gp.buttons[i].value || 1), performance.now());
          }
        }
        was.set(gp.index, now);
      }
      if (names.join("|") !== status.pads.join("|")) { status.pads = names; report(); }
    },
    get status() { return status; },
  };
}
