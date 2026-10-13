#!/usr/bin/env python3
"""slim-glb.py — any .glb with huge embedded textures -> a lean game file.
Geometry untouched; every embedded image is shrunk to a cap and re-encoded (JPEG for
colour/metal-rough, PNG kept only if it has transparency). Writes public/models/<Name>.glb
and a half-size copy in public/small/models/ for the cheap tiers.
    python3 tools/slim-glb.py <in.glb> <Name> [cap px, default 1024] [small cap, default 512]
"""
import io, json, struct, sys
from pathlib import Path
from PIL import Image

src, name = Path(sys.argv[1]), sys.argv[2]
CAP = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
SMALL = int(sys.argv[4]) if len(sys.argv) > 4 else 512
ROOT = Path(__file__).resolve().parent.parent / "public"

def read_glb(p):
    b = p.read_bytes(); jlen = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jlen]); off = 20 + jlen
    blen = struct.unpack("<I", b[off:off + 4])[0]
    return j, b[off + 8:off + 8 + blen]

def write_glb(j, data, out):
    jb = json.dumps(j, separators=(",", ":")).encode(); jb += b" " * (-len(jb) % 4)
    data += b"\0" * (-len(data) % 4)
    out.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(jb) + 8 + len(data))
                    + struct.pack("<I", len(jb)) + b"JSON" + jb + struct.pack("<I", len(data)) + b"BIN\0" + data)

def slim(cap, out):
    j, data = read_glb(src)
    views = j["bufferViews"]; chunks = []; new_views = []
    def add_view(blob, template=None):
        off = sum(len(c) for c in chunks); chunks.append(blob + b"\0" * (-len(blob) % 4))
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(blob)}
        if template:
            for k in ("byteStride", "target"):
                if k in template: v[k] = template[k]
        new_views.append(v); return len(new_views) - 1
    image_views = {im["bufferView"] for im in j.get("images", []) if "bufferView" in im}
    remap = {}
    for i, v in enumerate(views):
        o = v.get("byteOffset", 0); blob = data[o:o + v["byteLength"]]
        if i in image_views:
            im = Image.open(io.BytesIO(blob)); w, h = im.size
            if max(w, h) > cap:
                s = cap / max(w, h); im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
            alpha = im.mode in ("RGBA", "LA") and im.getextrema()[-1][0] < 255
            buf = io.BytesIO()
            if alpha: im.save(buf, "PNG", optimize=True); mime = "image/png"
            else: im.convert("RGB").save(buf, "JPEG", quality=85, optimize=True); mime = "image/jpeg"
            remap[i] = (add_view(buf.getvalue()), mime, (w, h), im.size)
        else:
            remap[i] = (add_view(blob, v), None, None, None)
    for im in j.get("images", []):
        if "bufferView" in im:
            nv, mime, was, now = remap[im["bufferView"]]; im["bufferView"] = nv; im["mimeType"] = mime
            print(f"  image {was[0]}x{was[1]} -> {now[0]}x{now[1]} {mime}")
    for a in j.get("accessors", []):
        if "bufferView" in a: a["bufferView"] = remap[a["bufferView"]][0]
    for k in ("skins",):
        for s in j.get(k, []):
            pass   # inverseBindMatrices are accessors: already remapped
    for an in j.get("animations", []):
        pass       # samplers reference accessors: already remapped
    j["bufferViews"] = new_views
    data = b"".join(chunks); j["buffers"] = [{"byteLength": len(data)}]
    write_glb(j, data, out); print(f"wrote {out} {out.stat().st_size/1e6:.1f} MB")

print(f"{src.name}: {src.stat().st_size/1e6:.1f} MB")
slim(CAP, ROOT / "models" / f"{name}.glb")
slim(SMALL, ROOT / "small" / "models" / f"{name}.glb")
