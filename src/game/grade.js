/* grade.js — a round's accuracy grade. Pure, no DOM.
 *
 * Every hit played during a round counts (practice included). Each scores by
 * how close it was to its note: dead on = 100%, sliding to 0 at the edge of
 * the difficulty's box; a hit with no note near it (OFF) scores 0.
 * Accuracy = the average score. The grade follows the accuracy. */

export const GRADES = [
  [95, "S"], [88, "A"], [78, "B"], [65, "C"], [0, "D"],
];

export function letter(accuracy) {
  for (const [min, g] of GRADES) if (accuracy >= min) return g;
  return "D";
}

/**
 * @param {Array<number|null>} offsets seconds from the note per hit (+ late); null = off-chart
 * @param {number} box the difficulty's window (seconds)
 * @returns {{accuracy:number, grade:string, hits:number, onBox:number, meanMs:number, biasMs:number}}
 */
export function gradeRound(offsets, box) {
  if (!offsets.length) return { accuracy: 0, grade: "D", hits: 0, onBox: 0, meanMs: 0, biasMs: 0 };
  let sum = 0, onBox = 0, abs = 0, bias = 0, n = 0;
  for (const o of offsets) {
    if (o === null) continue;
    const a = Math.abs(o);
    sum += Math.max(0, 1 - a / box);
    if (a <= box) onBox++;
    abs += a; bias += o; n++;
  }
  const accuracy = Math.round((1000 * sum) / offsets.length) / 10;
  return {
    accuracy,
    grade: letter(accuracy),
    hits: offsets.length,
    onBox,
    meanMs: n ? Math.round((1000 * abs) / n) : 0,
    biasMs: n ? Math.round((1000 * bias) / n) : 0,   // + = you drag (late), - = you rush (early)
  };
}
