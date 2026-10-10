#!/usr/bin/env python3
"""build-cyclops.py — the BOSS model (owner's Meshy "Canyon Cyclops", 2026-10-04).

Meshy ships one 22 MB .glb per animation clip, each a full copy of the skinned mesh
with 2K-4K textures. This folds them into ONE game file:
  - the mesh, skin and skeleton from the Walking file
  - every other file's animation clip appended (same skeleton: node lists are checked)
  - textures shrunk: colour + normal to 1024, metal/roughness to 512, JPEG
Writes public/models/Cyclops.glb and a 512 px copy in public/small/models/.

    python3 tools/build-cyclops.py [path-to-unzipped-folder]
"""
import io, json, struct, sys
from pathlib import Path
from PIL import Image

# usage: build-cyclops.py <unzipped Meshy folder> <OutName> [colour px] [metal/rough px]
#   e.g. build-cyclops.py .../Meshy_AI_Canyon_Sentinel_biped Sentinel 512 256
SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/fortissimo-dev/cyclops/Meshy_AI_Canyon_Cyclops_biped")
OUT_NAME = sys.argv[2] if len(sys.argv) > 2 else "Cyclops"
CAP_COLOR = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
CAP_MR = int(sys.argv[4]) if len(sys.argv) > 4 else 512
ROOT = Path(__file__).resolve().parent.parent / "public"
PREFIX = SRC.name + "_Animation_"
CLIPS = sorted(p.name[len(PREFIX):-len("_withSkin.glb")] for p in SRC.glob(f"{PREFIX}*_withSkin.glb"))
CLIPS.sort(key=lambda c: (c != "Walking", c))   # Walking first: it's the base


def read_glb(p):
    b = p.read_bytes()
    jlen = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack("<I", b[off:off + 4])[0]
    return j, b[off + 8:off + 8 + blen]


def view_bytes(j, data, i):
    bv = j["bufferViews"][i]
    o = bv.get("byteOffset", 0)
    return data[o:o + bv["byteLength"]]


def write_glb(j, chunks, out):
    """chunks: list of bytes, one per bufferView in j (in order); packs them 4-aligned"""
    buf = bytearray()
    for i, c in enumerate(chunks):
        while len(buf) % 4:
            buf.append(0)
        j["bufferViews"][i]["byteOffset"] = len(buf)
        j["bufferViews"][i]["byteLength"] = len(c)
        buf += c
    while len(buf) % 4:
        buf.append(0)
    j["buffers"] = [{"byteLength": len(buf)}]
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(buf)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
                    + struct.pack("<II", len(buf), 0x004E4942) + bytes(buf))
    return total


def build(cap_color, cap_mr, out):
    base_j, base_d = read_glb(SRC / f"{PREFIX}{CLIPS[0]}_withSkin.glb")
    chunks = [view_bytes(base_j, base_d, i) for i in range(len(base_j["bufferViews"]))]
    node_names = [n.get("name") for n in base_j["nodes"]]
    # the first clip is the base's own
    base_j["animations"][0]["name"] = CLIPS[0]
    for clip in CLIPS[1:]:
        j, d = read_glb(SRC / f"{PREFIX}{clip}_withSkin.glb")
        assert [n.get("name") for n in j["nodes"]] == node_names, f"{clip}: a different skeleton"
        anim = j["animations"][0]
        # copy every accessor (and its bufferView bytes) the clip's samplers use, re-based onto the output
        acc_map = {}
        for s in anim["samplers"]:
            for key in ("input", "output"):
                a = s[key]
                if a in acc_map:
                    continue
                acc = dict(j["accessors"][a])
                chunks.append(view_bytes(j, d, acc["bufferView"]))
                bv = dict(j["bufferViews"][acc["bufferView"]])
                bv.pop("byteOffset", None)
                bv["buffer"] = 0
                base_j["bufferViews"].append(bv)
                acc["bufferView"] = len(base_j["bufferViews"]) - 1
                acc.pop("byteOffset", None)
                base_j["accessors"].append(acc)
                acc_map[a] = len(base_j["accessors"]) - 1
        base_j["animations"].append({
            "name": clip,
            "samplers": [{**s, "input": acc_map[s["input"]], "output": acc_map[s["output"]]} for s in anim["samplers"]],
            "channels": anim["channels"],   # node indices match (checked above)
        })
    # textures: shrink and re-encode
    for im in base_j["images"]:
        bv = im["bufferView"]
        pic = Image.open(io.BytesIO(chunks[bv])).convert("RGB")
        cap = cap_mr if "metallic" in (im.get("name") or "") else cap_color
        if max(pic.size) > cap:
            pic = pic.resize((cap, cap), Image.LANCZOS)
        o = io.BytesIO()
        pic.save(o, "JPEG", quality=88, optimize=True)
        chunks[bv] = o.getvalue()
        im["mimeType"] = "image/jpeg"
    base_j["asset"]["generator"] = "Fortissimo build-cyclops.py (Meshy source)"
    total = write_glb(base_j, chunks, out)
    print(f"{out}: {total // 1024} KB, clips {[a['name'] for a in base_j['animations']]}, textures {cap_color}/{cap_mr}")


if __name__ == "__main__":
    build(CAP_COLOR, CAP_MR, ROOT / "models" / f"{OUT_NAME}.glb")
    build(CAP_COLOR // 2, CAP_MR // 2, ROOT / "small" / "models" / f"{OUT_NAME}.glb")
