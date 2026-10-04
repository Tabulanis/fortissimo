/* backing.js — how loud a section's BACK track plays (owner, 2026-10-04): quietly there from
 * the first second (a groove to lock into), coming up as the section's notes lock (to 50%), and FULL — as
 * set in Hackbeat — once the section is done. Pure. */
export const BACK_START = 0.3, BACK_LEARNING = 0.6;
export function backLevel(progress) {
  return progress >= 1 ? 1 : BACK_START + (BACK_LEARNING - BACK_START) * progress;
}
