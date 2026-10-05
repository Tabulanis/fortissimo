#!/usr/bin/env python3
"""Carmina-style demo round for Garden Rhythm, written as a Hackbeat tracker project.

Muse: Carmina Burana (O Fortuna) — D minor, a hammering chant line, timpani pulse,
and a build from a whisper to a tutti. Not a copy: our own tune, in that shape.
Sounds: real recorded orchestral/early instruments from Hackbeat's sound finder
(VCSL + VSCO-2, CC0), copied into samples/found/ with Hackbeat's own take-naming.
"""
import json, re, shutil, sys
from pathlib import Path
import numpy as np, soundfile as sf

HB = Path.home() / "aidojo/current/Hackbeat"
SAMPLES = HB / "samples"
FOUND = SAMPLES / "found"
LIB = "library/"

# Versilian names an octave low: a file called D2 sounds D3 (library.py, measured 2026-10-02)
PC = dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)
def sounding(name_pitch):          # "A#2" -> midi 58
    m = re.match(r"([A-G])(#?)(\d)", name_pitch)
    return 12 * (int(m.group(3)) + 2) + PC[m.group(1)] + (1 if m.group(2) else 0)

# role -> (library path, pitch in the file name or None for unpitched)
PICKS = {
    "Bass drum":  ("VCSL/Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v7_rr2_Sum.wav", None),
    "snare":      ("VSCO-2-CE/VSCO 1 Percussion/drums/snare/drum3_marching/snare3_fff_1.wav", None),
    "hihat":      ("VCSL/Idiophones/Struck Idiophones/Tambourine 4 - Legacy/tamb2_rr1.wav", None),
    "crash":      ("VCSL/Idiophones/Struck Idiophones/Clash Cymbals 1/cymbal_crash1_ff3.wav", None),
    "tom low":    ("VSCO-2-CE/Percussion/Timpani/Timpani2_Hit_v4_rr2_Sum.wav", None),
    "tom high":   ("VCSL/Membranophones/Struck Membranophones/Frame Drum/HDrumL_Hit_v3_rr1_Sum.wav", None),
    "Bass instrument bottom": ("VSCO-2-CE/Strings/Cello Section/pizzT/pizzT_A2_v2_RR2.wav", "A2"),
    "Bass instrument top":    ("VSCO-2-CE/Brass/OldTrombone/Sustain/Trombone_Sustain_D2_v4_1.wav", "D2"),
    "Treble instrument bottom": ("VCSL/Chordophones/Composite Chordophones/Folk Harp/EWHarp_Normal_D3_v3_RR1.wav", "D3"),
    "Treble instrument top":    ("VSCO-2-CE/Strings/Violin Section/Spic/VlnEns_Spic_C4_v2_rr2.wav", "C4"),
    "DRUM BACK":   ("VSCO-2-CE/VSCO 1 Percussion/varMetal/Gong/gong_hit_fff.wav", None),
    "BASS BACK":   ("VCSL/Aerophones/Edge-blown Aerophones/Pipe Organ/Loud Pedal/Rode_Pedal_F#1.wav", "F#1"),
    "TREBLE BACK": ("VSCO-2-CE/Strings/Cello Section/trem/trem_B2_v2_1.wav", "B2"),
    "anvil":       ("VCSL/Idiophones/Struck Idiophones/Anvil/Anvil_Hit3_v3_rr1_Mid.wav", None),
    "tuba":        ("VSCO-2-CE/Brass/Tuba/sus/Tuba3_sus_D2_v3_rr1_Mid.wav", "D2"),
    "bells":       ("VCSL/Idiophones/Struck Idiophones/Tubular Bells 2/TB_hit_D5_v4_1.wav", "D5"),
}


def take(rel):
    """copy a library sound into samples/found/ exactly as Hackbeat's /api/library/take names it"""
    src = SAMPLES / LIB / rel
    parts = Path(LIB + rel).parts
    stem = re.sub(r"[^A-Za-z0-9#._-]+", "-", "-".join(parts[1:2] + parts[2:-1][-2:]) + "-" + src.stem).strip("-")[:110]
    dst = FOUND / (stem + src.suffix.lower())
    FOUND.mkdir(parents=True, exist_ok=True)
    if not dst.exists():
        shutil.copyfile(src, dst)
    d, sr = sf.read(src)
    return dst.relative_to(SAMPLES).as_posix(), float(np.abs(d).max()), len(d) / sr


VOICE = {"attack": 0.002, "hold": 0, "decay": 0.08, "sustain": 1, "release": 0.12, "cutoff": 1, "reso": 0,
         "velToCutoff": 0.6, "glide": 0, "pan": 0, "gain": 1, "loop": False}
instruments, INST = [], {}
for role, (rel, pitch) in PICKS.items():
    path, peak, dur = take(rel)
    inst = {"path": path, "name": role, "voice": dict(VOICE)}
    if pitch:   # written note 60 plays the file as recorded; shift so a written pitch SOUNDS at that pitch
        inst["transpose"] = 60 - sounding(pitch)
    instruments.append(inst)
    INST[role] = len(instruments)   # tracker slots count from 1
    print(f"{role:26s} peak {peak:.2f} {dur:5.1f}s shift {inst.get('transpose', 0):+d}  {path}")

# ------------------------------------------------------------------ the tracks
def fx(vol, pan=0, reverb=0.3, low=0, mid=0, high=0, drive=None):
    return {"nudge": 0, "vol": vol, "pan": pan, "eq": {"low": low, "mid": mid, "high": high},
            "dist": {"on": drive is not None, "drive": drive or 0.4}, "crush": {"on": False, "bits": 8},
            "chorus": {"on": False, "rate": 1.5, "depth": 0.01, "mix": 0.5}, "delay": {"on": False, "send": 0.3},
            "reverb": {"on": True, "send": reverb}, "filter": {"on": False, "type": "lowpass", "freq": 2000, "q": 1}}

CHANNELS = [
    ("Bass drum", fx(1.0, 0, 0.5, low=6)), ("snare", fx(0.7, 0.1, 0.35)), ("hihat", fx(0.4, -0.3, 0.2)),
    ("crash", fx(0.45, 0.3, 0.4)), ("tom low", fx(1.0, -0.15, 0.5, low=4)), ("tom high", fx(1.2, 0.2, 0.4)),
    ("Bass instrument bottom", fx(1.0, -0.1, 0.3)), ("Bass instrument top", fx(1.15, 0.1, 0.45)),
    ("Treble instrument bottom", fx(1.0, -0.2, 0.4)), ("Treble instrument top", fx(0.9, 0.25, 0.4)),
    ("DRUM BACK", fx(0.35, 0, 0.6)), ("BASS BACK", fx(0.45, 0, 0.5, low=3)), ("TREBLE BACK", fx(0.35, 0, 0.7)),
]
CH = {name: i for i, (name, _) in enumerate(CHANNELS)}
channels = [{"name": n, "mute": False, "solo": False, "fx": f} for n, f in CHANNELS]

# ------------------------------------------------------------------ the music
BPM, RPB, BARS = 76, 8, 4
ROWS = BARS * 4 * RPB   # 128 rows = 4 bars a pattern
# D minor pitches (midi): the chant sits around D3 for the trombone, harp an octave up, violins two up
D2, A2, G2, C3, D3, E3, F3, Cs3, A3 = 38, 45, 43, 48, 50, 52, 53, 49, 57
# the chant: four bars of quarter notes, hammering and narrow, like a monks' line
CHANT = [[D3, D3, C3, D3], [F3, E3, D3, C3], [D3, D3, E3, F3], [E3, D3, Cs3, D3]]
# the last-section answer: a step higher and falling home
CHANT2 = [[F3, F3, E3, F3], [F3, F3, E3, D3], [F3, E3, D3, C3], [D3, D3, Cs3, D3]]
# the pizzicato ground: root, root, seventh, root / root, fifth, fourth, root
GROUND = [[D3, D3, C3, D3], [D3, A2, G2, D3]] * 2
HARP = [D3 + 12, F3 + 12, A2 + 24, D3 + 24]   # D4 F4 A4 D5 arpeggio


def pattern():
    return {"rows": ROWS, "data": [[None] * len(CHANNELS) for _ in range(ROWS)]}


def put(pat, ch, beat, note, inst, vol):
    r = int(round(beat * RPB))
    if 0 <= r < ROWS:
        pat["data"][r][CH[ch]] = {"note": note, "inst": INST[inst], "vol": vol}


def section(level, variant):
    """level 0..3 = whisper, build, climax, finale; variant 0/1 = first or second pass"""
    p = pattern()
    v = [34, 44, 54, 64][level]            # the dynamics rise section by section
    chant = CHANT2 if level == 3 and variant else CHANT
    for bar in range(BARS):
        b0 = bar * 4
        # --- drums
        put(p, "tom low", b0, 60, "tom low", v)                       # timpani on the one, always
        if level >= 1 or bar == 3:
            put(p, "tom low", b0 + 2, 60, "tom low", v - 8)           # ...and the three
        if level >= 1:
            put(p, "Bass drum", b0, 60, "Bass drum", v)
            put(p, "snare", b0 + 1, 60, "snare", v - 6)
            put(p, "snare", b0 + 3, 60, "snare", v)
            put(p, "snare", b0 + 3.5, 60, "snare", v - 14)            # pickup into the next bar
        if level >= 2:
            for q in (1, 2, 3):
                put(p, "Bass drum", b0 + q, 60, "Bass drum", v - 10)
            for e in range(8):
                put(p, "hihat", b0 + e / 2, 60, "hihat", v - 20 if e % 2 else v - 10)
            if bar % 2 == 1:
                put(p, "tom high", b0 + 2.5, 60, "tom high", v - 4)
                put(p, "tom high", b0 + 2.75, 60, "tom high", v - 8)
        elif level == 1:
            for e in range(4):
                put(p, "hihat", b0 + e, 60, "hihat", v - 14)
        if level >= 2 and bar in (0, 2):
            put(p, "crash", b0, 60, "crash", v - 6)
        if level == 3:
            put(p, "tom high", b0 + 1.5, 60, "tom high", v - 6)
            put(p, "tom high", b0 + 3.5, 60, "tom high", v - 2)
        # --- bass guns: the ground (pizz) and the chant (trombone)
        for q in range(4):
            if level == 0 and q % 2 == 1 and not variant:
                continue                                              # sparse to begin with
            put(p, "Bass instrument bottom", b0 + q, GROUND[bar][q], "Bass instrument bottom", v)
        if level >= 1:
            for q in range(4):
                put(p, "Bass instrument top", b0 + q, chant[bar][q], "Bass instrument top", v)
        # --- treble guns: harp arpeggio, violins doubling the chant
        if level == 0:
            put(p, "Treble instrument bottom", b0, HARP[0], "Treble instrument bottom", v)
            put(p, "Treble instrument bottom", b0 + 2, HARP[2 if bar % 2 else 1], "Treble instrument bottom", v - 6)
        else:
            for e in range(8):
                if level == 1 and e % 2:
                    continue
                put(p, "Treble instrument bottom", b0 + e / 2, HARP[e % 4] if level < 3 else HARP[(e * 3) % 4], "Treble instrument bottom", v - (8 if e % 2 else 0))
        if level >= 2:
            for q in range(4):
                put(p, "Treble instrument top", b0 + q, chant[bar][q] + 24, "Treble instrument top", v)
                if level == 3:
                    put(p, "Treble instrument top", b0 + q + 0.5, chant[bar][q] + 24, "Treble instrument top", v - 16)
        # --- the beds
        if bar == 0:
            put(p, "DRUM BACK", 0, 60, "DRUM BACK", [20, 30, 44, 64][level])       # gong at every section's door
            put(p, "BASS BACK", 0, D2, "BASS BACK", v - 4)                          # organ pedal drone D
            put(p, "BASS BACK", 8, D2 if level < 3 else D2 - 2, "BASS BACK", v - 4)   # ...C in the finale: the fall home
            put(p, "TREBLE BACK", 0, D3 + 12, "TREBLE BACK", v - 10)                # tremolo strings
            put(p, "TREBLE BACK", 8, F3 + 12 if level else D3 + 12, "TREBLE BACK", v - 10)
        if level >= 1 and bar in (0, 2):
            put(p, "BASS BACK", b0, D2, "tuba", v - 12)                             # tuba leaning on the root
        if level == 3:
            put(p, "DRUM BACK", b0 + 1.5, 60, "anvil", v - 8)                       # the forge: anvils on the off-beats
            put(p, "DRUM BACK", b0 + 3.5, 60, "anvil", v - 12)
            if bar in (0, 2):
                put(p, "TREBLE BACK", b0, D3 + 24, "bells", v - 6)                  # tubular bells tolling
    return p

# Two demo rounds, each ONE 4-bar loop the game replays and layers (drums -> guns -> boss):
#   Fortuna   — the chant in full cry (level 2: bass drum on every beat, tambourine eighths, violins doubling)
#   The Forge — the finale mood (level 3: the answer line, anvils, bells, harp running)
def write(name, level, variant):
    pat = section(level, variant)
    project = {
        "version": 2, "kind": "tracker", "bpm": BPM, "rowsPerBeat": RPB,
        "instruments": instruments, "channels": channels, "patterns": [pat], "order": [0],
        "fxBus": {"reverbDecay": 4.2, "delayTime": 0.3, "delayFb": 0.3},
        "ui": {"curPattern": 0, "curInstrument": 0, "cursor": {"row": 0, "ch": 0, "sub": 0, "slot": 0}, "octave": 4, "masterVol": 0.9, "showWave": True, "showVU": True, "zoom": 40},
    }
    out = HB / "projects" / f"{name}.json"
    out.write_text(json.dumps(project))
    cells = sum(1 for row in pat["data"] for c in row if c)
    print(f"wrote {out.name}: {BARS} bars at {BPM} bpm ({BARS * 4 * 60 / BPM:.1f} s a pass), {cells} cells")


write("Carmina-demo", 2, 0)
write("Carmina-forge", 3, 1)
