#!/usr/bin/env python3
"""compose-fourpart.py — THE DEMO SONG IN FOUR PARTS (owner, 2026-10-10: "do a demo of what you're thinking song-wise so there's a base").

Writes a Hackbeat project, ../Hackbeat/projects/Demo-FourPart.json, with four 4-bar patterns chained in order —
  0 intro · 1 verse · 2 prechorus · 3 chorus
— the shape he described (six songs, four parts each; the game picks parts or plays them all in order), written to the rules that
make a part work as a Fortissimo round: every part has a drum layer, a bass line and a treble line; same tempo, key and
instruments across the four; mood moves BETWEEN parts; each part loops on itself and its last bar leads into the next.
D minor, 100 BPM. Sounds: the recorded orchestral set already in Hackbeat/samples/found (VCSL + VSCO-2 CE, CC0).
Also renders a preview, --preview out.wav (a plain mix: pitch by resampling, no effects), so it can be heard without opening Hackbeat.

Rows: rowsPerBeat 8 → a bar is 32 rows, a part 128. Pitch: Hackbeat plays `note` as a real MIDI pitch once the instrument's
`transpose` is set so note 60 = C4 (the shipped projects' values, reused here). `inst` counts from 1. vol 0..64.
"""
import json, sys
from pathlib import Path

HB = Path.home() / "aidojo/current/Hackbeat"
BPM, RPB, BAR, ROWS = 100, 8, 32, 128
VOICE = {"attack": 0.002, "hold": 0, "decay": 0.08, "sustain": 1, "release": 0.12, "cutoff": 1, "reso": 0,
         "velToCutoff": 0.6, "glide": 0, "pan": 0, "gain": 1, "loop": False}
# the thirteen channels of a Fortissimo round, in the order the game reads them, + three extras playable on any channel
INSTS = [
    ("Bass drum", "found/VCSL-Struck-Membranophones-Bass-Drum-1-BDrumNew_hit_v7_rr2_Sum.wav", 0),
    ("snare", "found/VSCO-2-CE-snare-drum3_marching-snare3_fff_1.wav", 0),
    ("hihat", "found/VCSL-Struck-Idiophones-Tambourine-4---Legacy-tamb2_rr1.wav", 0),
    ("crash", "found/VCSL-Struck-Idiophones-Clash-Cymbals-1-cymbal_crash1_ff3.wav", 0),
    ("tom low", "found/VSCO-2-CE-Percussion-Timpani-Timpani2_Hit_v4_rr2_Sum.wav", 0),
    ("tom high", "found/VCSL-Struck-Membranophones-Frame-Drum-HDrumL_Hit_v3_rr1_Sum.wav", 0),
    ("Bass instrument bottom", "found/VSCO-2-CE-Cello-Section-pizzT-pizzT_A2_v2_RR2.wav", 3),
    ("Bass instrument top", "found/VSCO-2-CE-OldTrombone-Sustain-Trombone_Sustain_D2_v4_1.wav", 10),
    ("Treble instrument bottom", "found/VCSL-Composite-Chordophones-Folk-Harp-EWHarp_Normal_D3_v3_RR1.wav", -2),
    ("Treble instrument top", "found/VSCO-2-CE-Violin-Section-Spic-VlnEns_Spic_C4_v2_rr2.wav", -12),
    ("DRUM BACK", "found/VSCO-2-CE-varMetal-Gong-gong_hit_fff.wav", 0),
    ("BASS BACK", "found/VCSL-Pipe-Organ-Loud-Pedal-Rode_Pedal_F#1.wav", 18),
    ("TREBLE BACK", "found/VSCO-2-CE-Cello-Section-trem-trem_B2_v2_1.wav", 1),
    ("anvil", "found/VCSL-Struck-Idiophones-Anvil-Anvil_Hit3_v3_rr1_Mid.wav", 0),
    ("tuba", "found/VSCO-2-CE-Tuba-sus-Tuba3_sus_D2_v3_rr1_Mid.wav", 10),
    ("bells", "found/VCSL-Struck-Idiophones-Tubular-Bells-2-TB_hit_D5_v4_1.wav", -26),
]
CH = {name: i for i, (name, _, _) in enumerate(INSTS[:13])}
KICK, SNARE, HAT, CRASH, TLOW, THIGH, BASS, BASS2, TREB, TREB2, DBACK, BBACK, TBACK = range(13)
BELLS = 16   # instrument number (from 1) of the bells, played on the TREBLE BACK channel

# pitches (MIDI): D minor
D2, F2, G2, A2, Bb2, C3, D3, F3, G3, A3 = 38, 41, 43, 45, 46, 48, 50, 53, 55, 57
D4, E4, F4, G4, A4, Bb4, C5, D5, E5, F5, G5, A5, Bb5, C6, D6 = 62, 64, 65, 67, 69, 70, 72, 74, 76, 77, 79, 81, 82, 84, 86


def pattern(name):
    return {"name": name, "rows": ROWS, "data": [[None] * 13 for _ in range(ROWS)]}

def put(p, row, ch, note=60, vol=60, inst=None):
    p["data"][row][ch] = {"note": note, "inst": (ch + 1) if inst is None else inst, "vol": vol}

def bar(b, beat=0.0):   # row of bar b (0..3), beat 0..3.99
    return int(b * BAR + beat * RPB)

def eighths(p, ch, b, notes, vol=58):   # eight notes across bar b, None = rest
    for i, n in enumerate(notes):
        if n is not None: put(p, bar(b, i / 2), ch, n, vol)

def quarters(p, ch, b, notes, vol=58):
    for i, n in enumerate(notes):
        if n is not None: put(p, bar(b, i), ch, n, vol)

def hats8(p, b, vol=44):
    for i in range(8): put(p, bar(b, i / 2), HAT, 60, vol - (0 if i % 2 == 0 else 8))

def hats16(p, b, vol=44):
    for i in range(16): put(p, bar(b, i / 4), HAT, 60, vol - (0 if i % 4 == 0 else 10))

def fill(p, b, beat=3.0):   # a tom run into the next bar: low low high high on 16ths
    for i, ch in enumerate([TLOW, TLOW, THIGH, THIGH]): put(p, bar(b, beat + i / 4), ch, 60, 56)


# ---- 0 INTRO: a whisper — pulse on the kick, the harp states the tune, hats arrive in bar 3, the fill at the end says "here we go"
intro = pattern("intro")
for b in range(4):
    put(intro, bar(b, 0), KICK, 60, 52); put(intro, bar(b, 2), KICK, 60, 46)
    put(intro, bar(b, 0), BASS, D2, 56); put(intro, bar(b, 2), BASS, A2, 50)
for b in (2, 3): hats8(intro, b, 36)
put(intro, bar(3, 1), SNARE, 60, 48); put(intro, bar(3, 3), SNARE, 60, 54); fill(intro, 3, 3.0)
put(intro, bar(0, 0), BASS2, D3, 44); put(intro, bar(2, 0), BASS2, D3, 44)
quarters(intro, TREB, 0, [D4, F4, A4, D5], 52); quarters(intro, TREB, 1, [A4, F4, E4, D4], 50)
quarters(intro, TREB, 2, [D4, F4, A4, D5], 54); quarters(intro, TREB, 3, [C5, A4, G4, E4], 54)
put(intro, bar(3, 2), TREB2, A5, 46); put(intro, bar(3, 3), TREB2, D6, 50)
put(intro, bar(0, 0), DBACK, 60, 40)

# ---- 1 VERSE: the beat proper, the bass walks, the harp sings the tune, the violin answers off the beat
verse = pattern("verse")
for b in range(4):
    put(verse, bar(b, 0), KICK, 60, 60); put(verse, bar(b, 2), KICK, 60, 56); put(verse, bar(b, 3.5), KICK, 60, 50)
    put(verse, bar(b, 1), SNARE, 60, 58); put(verse, bar(b, 3), SNARE, 60, 60)
    hats8(verse, b)
put(verse, bar(0, 0), CRASH, 60, 56); fill(verse, 3, 3.0); fill(verse, 3, 2.0)
eighths(verse, BASS, 0, [D2, D2, F2, D2, D2, D2, A2, D2]); eighths(verse, BASS, 1, [C3, C3, A2, C3, C3, C3, G2, A2])
eighths(verse, BASS, 2, [D2, D2, F2, D2, D2, D2, A2, D2]); eighths(verse, BASS, 3, [Bb2, Bb2, A2, Bb2, A2, A2, G2, F2])
quarters(verse, BASS2, 0, [D3, None, None, None], 46); quarters(verse, BASS2, 1, [C3, None, None, None], 46)
quarters(verse, BASS2, 2, [D3, None, None, None], 46); quarters(verse, BASS2, 3, [Bb2, None, A2, None], 46)
quarters(verse, TREB, 0, [D4, F4, E4, D4]); eighths(verse, TREB, 1, [A4, None, G4, A4, F4, None, E4, D4])
quarters(verse, TREB, 2, [D4, F4, G4, A4]); eighths(verse, TREB, 3, [G4, A4, F4, None, E4, None, D4, None])
for b in range(4): put(verse, bar(b, 1.5), TREB2, A5 if b % 2 == 0 else G5, 48); put(verse, bar(b, 3.5), TREB2, F5, 44)

# ---- 2 PRECHORUS: the lift — four on the floor, hats double, bass climbs F → G → A, the line climbs with it
pre = pattern("prechorus")
for b in range(4):
    for i in range(4): put(pre, bar(b, i), KICK, 60, 60)
    put(pre, bar(b, 1), SNARE, 60, 58); put(pre, bar(b, 3), SNARE, 60, 60)
    hats8(pre, b) if b < 2 else hats16(pre, b)
put(pre, bar(0, 0), CRASH, 60, 56); fill(pre, 3, 3.0)
eighths(pre, BASS, 0, [F2, F2, F2, F2, F2, F2, A2, F2]); eighths(pre, BASS, 1, [G2, G2, G2, G2, G2, G2, Bb2, G2])
eighths(pre, BASS, 2, [A2, A2, A2, A2, A2, A2, C3, A2]); eighths(pre, BASS, 3, [A2, A2, C3, A2, D3, A2, C3, A2])
quarters(pre, BASS2, 0, [F3, None, None, None], 48); quarters(pre, BASS2, 1, [G3, None, None, None], 48)
quarters(pre, BASS2, 2, [A3, None, None, None], 50); quarters(pre, BASS2, 3, [A3, None, A3, None], 52)
quarters(pre, TREB, 0, [F4, G4, A4, Bb4]); quarters(pre, TREB, 1, [G4, A4, Bb4, C5])
quarters(pre, TREB, 2, [A4, C5, D5, E5]); quarters(pre, TREB, 3, [E5, D5, C5, A4])
for b in (2, 3): eighths(pre, TREB2, b, [A5] * 8, 44 + 4 * (b - 2))
put(pre, bar(3, 3), TBACK, A3, 40)

# ---- 3 CHORUS: everything — the pedal D, the big tune on the violin, harp running under it, bells on the bar, gong and organ behind
chorus = pattern("chorus")
for b in range(4):
    put(chorus, bar(b, 0), KICK, 60, 62); put(chorus, bar(b, 1.5), KICK, 60, 52); put(chorus, bar(b, 2), KICK, 60, 58)
    put(chorus, bar(b, 1), SNARE, 60, 60); put(chorus, bar(b, 3), SNARE, 60, 62)
    hats8(chorus, b, 46)
    put(chorus, bar(b, 0), TBACK, D5, 46, BELLS)
put(chorus, bar(0, 0), CRASH, 60, 60); put(chorus, bar(2, 0), CRASH, 60, 56); fill(chorus, 1, 3.0); fill(chorus, 3, 3.0)
for b in range(4): eighths(chorus, BASS, b, [D2] * 8 if b < 3 else [D2, D2, C3, C3, Bb2, Bb2, A2, A2], 58)
quarters(chorus, BASS2, 0, [D3, None, None, None], 50); quarters(chorus, BASS2, 1, [D3, None, None, None], 50)
quarters(chorus, BASS2, 2, [Bb2, None, None, None], 50); quarters(chorus, BASS2, 3, [A2, None, None, None], 50)
for b in range(4): eighths(chorus, TREB, b, [D5, A4, F4, A4, D5, A4, F4, A4] if b < 3 else [D5, A4, C5, A4, Bb4, G4, A4, G4], 50)
quarters(chorus, TREB2, 0, [D5, F5, A5, D6], 54); quarters(chorus, TREB2, 1, [C6, A5, F5, E5], 54)
quarters(chorus, TREB2, 2, [D5, F5, A5, Bb5], 56); quarters(chorus, TREB2, 3, [A5, G5, F5, E5], 56)
put(chorus, bar(0, 0), DBACK, 60, 44); put(chorus, bar(0, 0), BBACK, D2, 40)

PARTS = [intro, verse, pre, chorus]


def counts(p):
    d = sum(1 for r in p["data"] for c in range(6) if r[c]); b = sum(1 for r in p["data"] for c in (6, 7) if r[c]); t = sum(1 for r in p["data"] for c in (8, 9) if r[c])
    return d, b, t


def project():
    return {"version": 2, "kind": "tracker", "bpm": BPM, "rowsPerBeat": RPB,
            "instruments": [{"path": path, "name": name, "voice": dict(VOICE), **({"transpose": tr} if tr else {})} for name, path, tr in INSTS],
            "channels": [{"name": name, "mute": False, "solo": False, "fx": {}} for name, _, _ in INSTS[:13]],
            "patterns": PARTS, "order": [0, 1, 2, 3], "fxBus": {"reverbDecay": 3.2, "delayTime": 0.3, "delayFb": 0.25},
            "ui": {"curPattern": 0, "curInstrument": 0, "cursor": {"row": 0, "ch": 0, "sub": 0, "slot": 0}, "octave": 4, "masterVol": 0.9, "showWave": True, "showVU": True, "zoom": 40}}


def render(out):
    """a plain preview mix of the four parts in order: each note = its sample resampled to pitch, scaled by vol; sustained
    instruments cut at 2 beats with a fade; no effects. Not Hackbeat's engine — close enough to judge the writing."""
    import numpy as np, soundfile as sf
    from scipy.signal import resample_poly
    from fractions import Fraction
    SR = 44100; spr = 60 / BPM / RPB; total = int(ROWS * 4 * spr * SR + SR * 3); mix = np.zeros(total)
    cache = {}
    def sample(i):
        if i not in cache:
            d, sr = sf.read(HB / "samples" / INSTS[i][1]); d = d.mean(axis=1) if d.ndim > 1 else d
            if sr != SR: d = resample_poly(d, SR, sr)
            cache[i] = d / (np.abs(d).max() or 1)
        return cache[i]
    for k, p in enumerate(PARTS):
        for r, row in enumerate(p["data"]):
            for ch, cell in enumerate(row):
                if not cell: continue
                i = cell["inst"] - 1; semis = cell["note"] - 60 + INSTS[i][2]; d = sample(i)
                ratio = Fraction(2 ** (-semis / 12)).limit_denominator(200); d = resample_poly(d, ratio.numerator, ratio.denominator) if semis else d
                hold = int(SR * 60 / BPM * 2)
                if len(d) > hold and i in (7, 11, 12, 14): d = d[:hold] * np.concatenate([np.ones(hold - 2000), np.linspace(1, 0, 2000)])
                at = int((k * ROWS + r) * spr * SR); n = min(len(d), total - at)
                mix[at:at + n] += d[:n] * (cell["vol"] / 64) * (0.5 if i < 6 else 0.4)
    mix /= max(1.0, np.abs(mix).max() / 0.9); sf.write(out, mix, SR)


if __name__ == "__main__":
    for p in PARTS: print(f"{p['name']:10s} drums {counts(p)[0]:3d}  bass {counts(p)[1]:3d}  treble {counts(p)[2]:3d}")
    dst = HB / "projects/Demo-FourPart.json"; dst.write_text(json.dumps(project())); print("wrote", dst)
    if "--preview" in sys.argv: out = sys.argv[sys.argv.index("--preview") + 1]; render(out); print("preview", out)
