export const DIFFICULTY = {
  // window = the lock box (and auto-correct's box), +/- seconds. Widened
  // 2026-10-02: the sixteenth-note fill in Part 4 almost never locked on
  // Normal (simulated tight player: 48%). Each box stays under half a
  // sixteenth at its tempo, so a hit can't be counted for the wrong note.
  easy:   { name: "Easy",   window: 0.120, ratio: 0.75, extras: 2, bpm: 60 },
  normal: { name: "Normal", window: 0.085, ratio: 1.00, extras: 1, bpm: 80 },
  hard:   { name: "Hard",   window: 0.050, ratio: 1.00, extras: 0, bpm: 100 },
  expert: { name: "Expert", window: 0.025, ratio: 1.00, extras: 0, bpm: 112 },
};
