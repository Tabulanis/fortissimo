/* session.js — session recording. Pure: no DOM, no audio.
   Every lane press (both modes) is logged exactly as played — the exact,
   never-snapped time relative to the clock's first beat — and toJSON emits
   the whole session, ghosts included, as plain data. */

export class SessionLog {
  /**
   * @param {{bpm: number, loopBeats: number, layout: object}} cfg
   */
  constructor({ bpm, loopBeats, layout }) {
    this.bpm = bpm;
    this.loopBeats = loopBeats;
    this.layout = layout;
    this.hits = [];
  }

  /**
   * Log one press, exactly as played.
   * @param {string} lane lane name
   * @param {string} drum the drum that sounded
   * @param {number} t the press time on the audio clock (s)
   * @param {number} velocity the velocity the press actually played with
   * @param {string} mode "drum" or "free"
   * @param {string} label HIT/EARLY/LATE/OFF in drum mode, FREE in freestyle
   */
  add({ lane, drum, t, velocity, mode, label }) {
    this.hits.push({ lane, drum, t, velocity, mode, label });
  }

  /**
   * Serialize the session.
   * @param {number} first the time of beat index 0 (s)
   * @param {import("./ghosts.js").Ghosts|null} ghosts
   * @returns {object} plain JSON data, format "garden-rhythm/1"
   */
  toJSON(first, ghosts) {
    return {
      format: "garden-rhythm/1",
      savedAt: new Date().toISOString(),
      bpm: this.bpm,
      loopBeats: this.loopBeats,
      layout: this.layout,
      hits: this.hits.map((h) => ({
        lane: h.lane,
        drum: h.drum,
        time: h.t - first,
        velocity: h.velocity,
        mode: h.mode,
        label: h.label,
      })),
      ghosts: ghosts ? ghosts.toData() : {},
    };
  }
}
