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
export const MIN_NOTES_TO_SHARE = 6;   // an instrument this busy lends itself to empty slots

export function fillKit(notes, groups) {
  const out = notes.map((n) => ({ ...n }));
  const aliases = {};
  for (const group of groups) {
    const count = Object.fromEntries(group.map((l) => [l, 0]));
    for (const n of out) if (n.lane in count) count[n.lane]++;
    const empties = group.filter((l) => count[l] === 0);
    const owners = group.filter((l) => count[l] >= MIN_NOTES_TO_SHARE).sort((a, b) => count[b] - count[a] || group.indexOf(a) - group.indexOf(b));
    if (!empties.length || !owners.length) continue;
    // deal the empty slots to the owners, busiest first, round and round
    const standIns = Object.fromEntries(owners.map((o) => [o, []]));
    empties.forEach((e, i) => { const o = owners[i % owners.length]; standIns[o].push(e); aliases[e] = o; });
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
  return { notes: out, aliases };
}
