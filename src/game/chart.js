/* chart.js — drum-mode layout and the 4-bar chart. Pure data. */

// Two highways, TOP and BOTTOM. Lane keys play that lane's drum immediately;
// timing only changes loudness (velocityFor) — never the sound itself.
export const LAYOUT = {
  top: [
    { name: "hat", key: "q", drum: "hat" },
    { name: "snare", key: "w", drum: "snare" },
    { name: "crash", key: "e", drum: "crash" },
  ],
  bottom: [
    { name: "kick", key: "a", drum: "kick" },
    { name: "tom low", key: "s", drum: "tomLow" },
    { name: "tom high", key: "d", drum: "tomHigh" },
  ],
};

// Lanes 4-5 (r/t and v/b) join later; reserved here so indices stay stable.
export const KEYS = {
  top: ["q", "w", "e", "r", "t"],
  bottom: ["a", "s", "d", "f", "g"],
};

// Beats are quarter notes; 16 beats = 4 bars.
export const CHART = {
  loopBeats: 16,
  notes: {
    hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5,
          8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5],
    snare: [1, 3, 5, 7, 9, 11, 13, 15],
    kick: [0, 2, 2.5, 4, 6, 6.5, 8, 10, 10.5, 12, 14],
    crash: [0],
    tomHigh: [12, 12.5, 13],
    tomLow: [13.5, 14, 14.5],
  },
};
