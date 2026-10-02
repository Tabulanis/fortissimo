/* courtyardIR.js — the courtyard's acoustics as an impulse response. Pure maths.

   Built from the arena's real measurements (courtyard.js), not a generic hall:
     - side walls: the colonnade back walls, inner faces 9.2 m either side of the
       player -> first bounce at 2 x 9.2 / 343 = 53.6 ms, then a FLUTTER: the
       sound ping-pongs between the parallel walls, every 53.6 ms, fading and
       dulling with each bounce
     - columns: in front of those walls at 6.8 m, a softer, scattered
       reflection at ~40 ms (each column throws back a little, slightly smeared)
     - far wall: 46.4 m ahead -> a distinct SLAPBACK at 270.6 ms, from the front,
       quieter and darker (air soaks up the highs over 93 m)
     - no roof: energy escapes upward, so the diffuse tail is light and short
       (RT60 ~1.3 s) compared with an enclosed hall
   Each reflection is a short soft blip (not a single-sample click), low-passed
   more the later it arrives. Returns [left, right] Float32Arrays. */

export const C = 343;                 // speed of sound, m/s
export const SIDE_WALL = 9.2;         // m, player to each colonnade back wall (inner face)
export const COLUMNS = 6.8;           // m, player to each colonnade line
export const FAR_WALL = 46.4;         // m, player to the far building

export const T_SIDE = (2 * SIDE_WALL) / C;      // 0.0536 s
export const T_COLUMNS = (2 * COLUMNS) / C;     // 0.0397 s
export const T_FAR = (2 * FAR_WALL) / C;        // 0.2706 s

/** a seeded random so the response is the same every load (tests can rely on it) */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * @param {number} sampleRate
 * @param {number} seconds length of the response
 * @returns {[Float32Array, Float32Array]}
 */
export function makeCourtyardIR(sampleRate, seconds = 2.0) {
  const n = Math.floor(sampleRate * seconds);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rand = rng(1234567);

  // a reflection: a short Hann-windowed blip, wider (= darker) for duller reflections
  const blip = (t, gl, gr, dull = 0) => {
    const w = Math.max(3, Math.round(sampleRate * (0.00025 + 0.0012 * dull)));   // 0.25..1.45 ms
    const i0 = Math.round(t * sampleRate) - (w >> 1);
    let norm = 0;
    for (let k = 0; k < w; k++) norm += 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / w);
    for (let k = 0; k < w; k++) {
      const i = i0 + k;
      if (i < 0 || i >= n) continue;
      const v = (0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / w)) / norm;
      L[i] += gl * v; R[i] += gr * v;
    }
  };

  // columns: a scattered first reflection each side (several small arrivals over ~4 ms)
  for (let k = 0; k < 6; k++) {
    const jitter = (rand() - 0.5) * 0.004;
    blip(T_COLUMNS + jitter, 0.07 + 0.03 * rand(), 0.03, 0.2);   // left colonnade
    blip(T_COLUMNS + (rand() - 0.5) * 0.004, 0.03, 0.07 + 0.03 * rand(), 0.2);   // right
  }

  // side walls: first bounce, then the flutter between the parallel walls
  for (let order = 1; order <= 16; order++) {
    const t = order * T_SIDE + (rand() - 0.5) * 0.0015 * order;   // the columns smear it more each pass
    const g = 0.55 * Math.pow(0.62, order - 1);
    const dull = Math.min(1, order * 0.12);
    // odd bounces come back from the far side, so they land a little louder in one ear
    const side = order % 2 ? 1 : -1;
    blip(t, g * (1 + 0.25 * side), g * (1 - 0.25 * side), dull);
  }

  // far wall: the slapback from straight ahead, then it flutters too
  blip(T_FAR, 0.6, 0.6, 0.45);
  for (let order = 1; order <= 4; order++) {
    const g = 0.2 * 0.45 * Math.pow(0.6, order - 1);
    blip(T_FAR + order * T_SIDE, g * (order % 2 ? 1.2 : 0.8), g * (order % 2 ? 0.8 : 1.2), 0.8);
  }

  // diffuse tail: light (open sky), builds after the first reflections, darkens as it decays
  const rt60 = 1.3, k60 = Math.log(1000) / rt60;
  const start = Math.round(T_COLUMNS * sampleRate);
  let lpL = 0, lpR = 0;
  for (let i = start; i < n; i++) {
    const t = i / sampleRate;
    const build = Math.min(1, (t - T_COLUMNS) / 0.12);          // density grows over ~120 ms
    const env = 0.022 * build * Math.exp(-k60 * t);         // light: the open sky keeps the flutter and slapback audible
    const cut = 0.6 - 0.5 * Math.min(1, t / 1.2);                // one-pole lowpass closing with time
    lpL += cut * ((rand() * 2 - 1) - lpL);
    lpR += cut * ((rand() * 2 - 1) - lpR);
    L[i] += lpL * env;
    R[i] += lpR * env;
  }
  return [L, R];
}
