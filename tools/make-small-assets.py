#!/usr/bin/env python3
"""make-small-assets.py — the cheap tiers' textures (owner, 2026-10-03: "cut the size
for textures in lowest mode to 512").

Writes public/small/: every texture in public/textures at most 512 px, and every
model in public/models with its embedded images at most 512 px. On lowest and potato
the game loads these instead (stage3d.js, a loading-manager URL swap), so the GPU never
sees anything bigger and the tablet downloads less. Re-run after changing a texture.

    python3 tools/make-small-assets.py
"""
import io, json, struct
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "public"
OUT = ROOT / "small"
CAP = 512


def shrink(im):
    if max(im.size) <= CAP:
        return im
    k = CAP / max(im.size)
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)


def textures():
    (OUT / "textures").mkdir(parents=True, exist_ok=True)
    for f in sorted((ROOT / "textures").iterdir()):
        if f.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
            continue
        im = Image.open(f)
        small = shrink(im)
        dst = OUT / "textures" / f.name
        fmt = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}[f.suffix.lower()]
        small.save(dst, fmt, **({"quality": 88} if fmt in ("JPEG", "WEBP") else {}))
        print(f"{f.name}: {im.size} -> {small.size}, {f.stat().st_size // 1024} -> {dst.stat().st_size // 1024} KB")


def glb(src, dst):
    """rebuild a .glb with every embedded image shrunk (the bin chunk repacked, 4-byte aligned)"""
    b = src.read_bytes()
    jlen = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jlen])
    boff = 20 + jlen
    bin_len = struct.unpack("<I", b[boff:boff + 4])[0]
    data = b[boff + 8:boff + 8 + bin_len]
    images = {im["bufferView"]: im for im in j.get("images", []) if "bufferView" in im}
    out = bytearray()
    for i, bv in enumerate(j["bufferViews"]):
        chunk = data[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        if i in images:
            im = Image.open(io.BytesIO(chunk))
            buf = io.BytesIO()
            shrink(im).save(buf, "PNG" if images[i].get("mimeType") == "image/png" else "JPEG", optimize=True)
            chunk = buf.getvalue()
        while len(out) % 4:
            out.append(0)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(chunk)
        out += chunk
    while len(out) % 4:
        out.append(0)
    j["buffers"][0]["byteLength"] = len(out)
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    dst.write_bytes(struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
                    + struct.pack("<II", len(out), 0x004E4942) + bytes(out))
    print(f"{src.name}: {len(b) // 1024} -> {total // 1024} KB")


def models():
    (OUT / "models").mkdir(parents=True, exist_ok=True)
    for f in sorted((ROOT / "models").glob("*.glb")):
        glb(f, OUT / "models" / f.name)


if __name__ == "__main__":
    textures()
    models()
