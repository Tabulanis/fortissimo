/* kit.js — FILL THE KIT (owner, 2026-10-04). Pure.
 *
 * The stage is laid out for a maxed song: six drums, two rows of eight guns a side. Most
 * songs don't fill it (Dope: no toms, most of the treble just sits there). So when a song
 * is loaded, every empty slot in a group becomes a STAND-IN for one of the group's busiest
 * instruments: it plays that instrument's sound, and the busy instrument's notes are dealt
 * round the original and its stand-ins in turn — three bass drums when the song is all
 * bass drum, every gun in a row firing when only three had notes. Pitches stay (a note's
 * own midi travels with it). Nothing is invented: it's the song's notes, spread wider.
 *
 * fillKit(notes, groups) -> { notes, aliases }
 *   groups: arrays of lane names (each a group that fills among itself)
 *   aliases: { standInLane: ownerLane } — the game points each stand-in's sound at its owner
 */
export const NOTES_PER_STAND_IN = 10;   // an instrument earns one stand-in per this many notes (owner, 2026-10-04: "16 max, but few if not needed")

/**
 * @returns {{notes, aliases, present: string[][]}}  present: per group, the lanes that end up with notes (the round's slots)
 */
export function fillKit(notes, groups, { per = NOTES_PER_STAND_IN } = {}) {
  const out = notes.map((n) => ({ ...n }));
  const aliases = {};
  const present = [];
  for (const group of groups) {
    const count = Object.fromEntries(group.map((l) => [l, 0]));
    for (const n of out) if (n.lane in count) count[n.lane]++;
    const empties = group.filter((l) => count[l] === 0);
    // busiest first; each owner wants floor(count / per) stand-ins
    const owners = group.filter((l) => Math.floor(count[l] / per) >= 1).sort((a, b) => count[b] - count[a] || group.indexOf(a) - group.indexOf(b));
    const want = Object.fromEntries(owners.map((o) => [o, Math.floor(count[o] / per)]));
    const standIns = Object.fromEntries(owners.map((o) => [o, []]));
    // deal the empty slots round the owners, busiest first, each only as many as it earned
    let e = 0;
    for (let round = 0; e < empties.length && owners.some((o) => standIns[o].length < want[o]); round++) {
      for (const o of owners) { if (e >= empties.length) break; if (standIns[o].length < want[o]) { standIns[o].push(empties[e]); aliases[empties[e]] = o; e++; } }
    }
    present.push(group.filter((l) => count[l] > 0 || l in aliases));
    if (!owners.length || !e) continue;
    // each owner's notes, in time order, go owner, stand-in 1, stand-in 2, owner, ...
    for (const o of owners) {
      const mine = standIns[o];
      if (!mine.length) continue;
      const ring = [o, ...mine];
      let j = 0;
      for (const n of out.slice().sort((a, b) => a.beat - b.beat)) {
        if (n.lane !== o) continue;
        const to = ring[j++ % ring.length];
        if (to !== o) { n.lane = to; n.sound = o; }
      }
    }
  }
  return { notes: out, aliases, present };
}

/** the stage's slots for a round (what fillKit left present), per group in KIT_GROUPS order:
 *  drums (lane names), bass bottom / top, treble bottom (slot indices 0..7 within the row) */
export function kitPlan(present) {
  const slots = (lanes) => lanes.map((l) => (+l.split(" ")[1] - 1) % 8).sort((a, b) => a - b);
  return { drums: present[0], bass: { bottom: slots(present[1]), top: slots(present[2]) }, treble: { bottom: slots(present[3]), top: [0, 4] } };
}
