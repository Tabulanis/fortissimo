#!/usr/bin/env python3
"""make-banks.py — a WORLD's sound banks (owner, 2026-10-07: off Hackbeat; each world has its own
instruments). Copies the chosen samples (wav + ogg) into public/rounds/samples/banks/<world>/ and
writes public/banks/<world>.json — what the song-maker's pickers offer:
  { world, name, drums: [{ id, name, sounds: { hat, snare, crash, kick, "tom low", "tom high" } }],
    bass: [{ id, name, sample, root }], treble: [...] }
paths are relative to /rounds/samples/ (the game's sample root); `root` is the MIDI pitch the sample
really sounds (VCSL files are named an octave LOW — measured — so their root is +12 on the name).
    python3 tools/make-banks.py        (Rome; add a WORLDS entry for the next world)"""
import json, shutil, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "public"
SRC = ROOT / "rounds" / "samples"
F = "found/"
NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
def midi(name, vcsl=False):   # "A2" -> 45; VCSL names sound an octave higher than written
    m = re.match(r"([A-G]#?)(-?\d)", name); return 12 * (int(m.group(2)) + 1) + NOTE[m.group(1)] + (12 if vcsl else 0)

WORLDS = {
  "rome": {
    "name": "Rome",
    "drums": [
      {"id": "courtyard", "name": "Courtyard kit", "sounds": {"hat": "garden/hat.wav", "snare": "garden/snare.wav", "crash": "garden/crash.wav",
        "kick": "garden/kick.wav", "tom low": "garden/tom_low.wav", "tom high": "garden/tom_high.wav"}},
      {"id": "legion", "name": "Legion kit", "sounds": {
        "hat": F + "VCSL-Struck-Idiophones-Tambourine-4---Legacy-tamb2_rr1.wav",
        "snare": F + "VSCO-2-CE-snare-drum3_marching-snare3_fff_1.wav",
        "crash": F + "VCSL-Struck-Idiophones-Clash-Cymbals-1-cymbal_crash1_ff3.wav",
        "kick": F + "VCSL-Struck-Membranophones-Bass-Drum-1-BDrumNew_hit_v7_rr2_Sum.wav",
        "tom low": F + "VSCO-2-CE-Percussion-Timpani-Timpani2_Hit_v4_rr2_Sum.wav",
        "tom high": F + "VCSL-Struck-Membranophones-Frame-Drum-HDrumL_Hit_v3_rr1_Sum.wav"}},
    ],
    "bass": [
      {"id": "bass-bars", "name": "Bass bars", "sample": "garden/bass_bars.wav", "root": 36},          # recorded at C2
      {"id": "cello-pizz", "name": "Cello pizzicato", "sample": F + "VSCO-2-CE-Cello-Section-pizzT-pizzT_A2_v2_RR2.wav", "root": midi("A2")},
      {"id": "trombone", "name": "Trombone", "sample": F + "VSCO-2-CE-OldTrombone-Sustain-Trombone_Sustain_D2_v4_1.wav", "root": midi("D2")},
      {"id": "tuba", "name": "Tuba", "sample": F + "VSCO-2-CE-Tuba-sus-Tuba3_sus_D2_v3_rr1_Mid.wav", "root": midi("D2")},
    ],
    "treble": [
      {"id": "treble-bars", "name": "Treble bars", "sample": "garden/treble_bars.wav", "root": 72},    # recorded at C5
      {"id": "folk-harp", "name": "Folk harp", "sample": F + "VCSL-Composite-Chordophones-Folk-Harp-EWHarp_Normal_D3_v3_RR1.wav", "root": midi("D3", vcsl=True)},
      {"id": "violin-spic", "name": "Violin spiccato", "sample": F + "VSCO-2-CE-Violin-Section-Spic-VlnEns_Spic_C4_v2_rr2.wav", "root": midi("C4")},
      {"id": "tubular-bells", "name": "Tubular bells", "sample": F + "VCSL-Struck-Idiophones-Tubular-Bells-2-TB_hit_D5_v4_1.wav", "root": midi("D5", vcsl=True)},
    ],
  },
}

for world, W in WORLDS.items():
    dest = SRC / "banks" / world; dest.mkdir(parents=True, exist_ok=True)
    def own(path):   # copy wav + ogg into the world's bank folder; return the new path
        src = SRC / path; name = Path(path).name
        for ext in (".wav", ".ogg"):
            s = src.with_suffix(ext)
            if s.exists(): shutil.copy2(s, dest / Path(name).with_suffix(ext).name)
        if not (dest / name).exists(): raise SystemExit(f"missing sample {path}")
        return f"banks/{world}/{name}"
    out = {"world": world, "name": W["name"], "drums": [], "bass": [], "treble": []}
    for k in W["drums"]: out["drums"].append({**k, "sounds": {lane: own(p) for lane, p in k["sounds"].items()}})
    for kind in ("bass", "treble"):
        for b in W[kind]: out[kind].append({**b, "sample": own(b["sample"])})
    (ROOT / "banks").mkdir(exist_ok=True)
    (ROOT / "banks" / f"{world}.json").write_text(json.dumps(out, indent=1) + "\n")
    print(f"{world}: {len(out['drums'])} kits, {len(out['bass'])} bass sets, {len(out['treble'])} treble sets")
(ROOT / "banks" / "worlds.json").write_text(json.dumps([{"id": w, "name": W["name"]} for w, W in WORLDS.items()], indent=1) + "\n")
