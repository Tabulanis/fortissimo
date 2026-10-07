#!/usr/bin/env python3
"""hydra-jaw-labels.py — bake a per-vertex _JAW flag (1 = moves with the jaw bone, 0 = skull/neck)
into public/models/HydraHead.glb (+ the small copy) so hydra.js weights the teeth RIGIDLY to
the right bone (owner, 2026-10-06). Ownership comes from the MESH ITSELF: seeds that are
clearly jaw (below the lower gum line, in front of the hinge) and clearly skull (above the
mouth line or behind the hinge) grow outward along the mesh's triangle edges; every vertex —
teeth included — takes the label it is physically attached to. A separate shell (a tooth
modelled as its own piece) is labelled by where its root sits."""
import struct, json, sys
from collections import deque
from pathlib import Path

# measured from a side density map of the mesh (2026-10-06): the head is tilted — the jaw hinge sits at
# y 0.33 z 0.22 and the lower jaw runs diagonally down to its tip at y -0.03 z 0.78; the upper jaw is
# y 0.5..0.75 at the snout; the fangs hang into the cavity between
HINGE_Y, HINGE_Z, NECK_TOP = 0.33, 0.22, -0.25
jawline = lambda z: HINGE_Y - 0.36 * max(0.0, z - HINGE_Z) / 0.56   # the lower jaw's centre line, hinge -> tip

def read(p):
    b = p.read_bytes(); n = struct.unpack_from("<I", b, 12)[0]; j = json.loads(b[20:20 + n]); blen = struct.unpack_from("<I", b, 20 + n)[0]
    return j, bytearray(b[28 + n:28 + n + blen])
def acc(j, bin, i):
    a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]; off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]]; fmt = {5126: "f", 5123: "H", 5125: "I"}[a["componentType"]]
    size = struct.calcsize("<" + fmt * comps); stride = bv.get("byteStride", size)
    return [struct.unpack_from("<" + fmt * comps, bin, off + k * stride) for k in range(a["count"])]

def label(p):
    j, bin = read(p); prim = j["meshes"][0]["primitives"][0]
    P = acc(j, bin, prim["attributes"]["POSITION"]); I = [t[0] for t in acc(j, bin, prim["indices"])]
    n = len(P); adj = [[] for _ in range(n)]
    for k in range(0, len(I), 3):
        a, b, c = I[k], I[k + 1], I[k + 2]; adj[a] += [b, c]; adj[b] += [a, c]; adj[c] += [a, b]
    lab = [-1] * n; q = deque()
    for i, (x, y, z) in enumerate(P):
        if y < NECK_TOP: lab[i] = 0                                              # neck: never jaw
        elif z > 0.36 and y < jawline(z) + 0.05: lab[i] = 1                     # clearly the lower jaw body: on or below its centre line, forward of the hinge
        elif y > jawline(z) + 0.24 or z < HINGE_Z - 0.14 or y < 0.02: lab[i] = 0   # clearly skull/neck: the upper jaw above the cavity, behind the hinge, or the throat
        if lab[i] >= 0: q.append(i)
    seeds = sum(1 for v in lab if v >= 0)
    while q:                                                                      # grow both labels along the edges
        i = q.popleft()
        for k in adj[i]:
            if lab[k] < 0: lab[k] = lab[i]; q.append(k)
    # shells nothing reached (separate pieces): by where their highest point sits
    for i in range(n):
        if lab[i] < 0:
            comp, stack = [], [i]; lab[i] = -2
            while stack:
                v = stack.pop(); comp.append(v)
                for k in adj[v]:
                    if lab[k] == -1: lab[k] = -2; stack.append(k)
            top = max(P[v][1] for v in comp); root_is_up = top > HINGE_Y
            for v in comp: lab[v] = 0 if root_is_up else 1
    jaw = sum(lab); print(f"{p.name}: {n} vertices, {seeds} seeds, jaw {jaw}, skull/neck {n - jaw}")
    # SOFT TISSUE (owner: "smooth the weights on the red parts of the jaw, they should stretch"):
    # the mouth lining and tongue are painted red — a big, unmistakable area in the colour map —
    # so those vertices get a weight DIFFUSED across the mesh from the hard labels around them,
    # anchored by bone and teeth, which stay rigid at exactly 0 or 1.
    # The lower jaw is mostly a separate shell (only ~13 vertices stitch it to the skull), so a
    # blend along the mesh's edges can't reach across the mouth: the blend is by DISTANCE instead —
    # a red vertex's weight is set by how far it sits from the nearest hard jaw vertex vs the
    # nearest hard skull vertex (head only, not the neck), eased so the extremes stay rigid.
    w = [float(v) for v in lab]
    red = {i for i in red_vertices(j, bin, prim) if P[i][1] > HINGE_Y - 0.45 and P[i][2] > HINGE_Z - 0.1}   # the mouth only: red texels on the neck scales are not soft tissue
    anchors_j = [P[i] for i in range(n) if lab[i] == 1 and i not in red]
    anchors_s = [P[i] for i in range(n) if lab[i] == 0 and i not in red and P[i][1] > NECK_TOP + 0.1]
    def dmin(p, A): return min((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 + (p[2] - a[2]) ** 2 for a in A) ** 0.5
    smooth = lambda x: 0.0 if x <= 0 else 1.0 if x >= 1 else x * x * (3 - 2 * x)
    for i in red:
        dj, ds = dmin(P[i], anchors_j), dmin(P[i], anchors_s)
        w[i] = smooth((ds / (dj + ds + 1e-9) - 0.15) / 0.7)
    soft = sum(1 for i in red if 0.05 < w[i] < 0.95)
    print(f"  red soft tissue: {len(red)} vertices, {soft} of them now blended between the bones")
    # write the weight as a new float attribute _JAW: append a bufferView + accessor
    data = struct.pack("<" + "f" * n, *w)
    while len(bin) % 4: bin.append(0)
    j["bufferViews"].append({"buffer": 0, "byteOffset": len(bin), "byteLength": len(data)}); bin += data
    j["accessors"].append({"bufferView": len(j["bufferViews"]) - 1, "componentType": 5126, "count": n, "type": "SCALAR", "min": [0.0], "max": [1.0]})
    prim["attributes"]["_JAW"] = len(j["accessors"]) - 1
    j["buffers"][0]["byteLength"] = len(bin)
    jb = json.dumps(j, separators=(",", ":")).encode(); jb += b" " * (-len(jb) % 4)
    p.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(jb) + 8 + len(bin)) + struct.pack("<I", len(jb)) + b"JSON" + jb + struct.pack("<I", len(bin)) + b"BIN\0" + bytes(bin))

def red_vertices(j, bin, prim):
    """indices of vertices whose colour-map texel is red (mouth lining, tongue)"""
    import io
    from PIL import Image
    UV = acc(j, bin, prim["attributes"]["TEXCOORD_0"])
    mat = j["materials"][prim["material"]]; ti = mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    bv = j["bufferViews"][j["images"][j["textures"][ti]["source"]]["bufferView"]]
    img = Image.open(io.BytesIO(bytes(bin[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]))).convert("RGB")
    W, H = img.size; px = img.load(); out = []
    for i, (u, v) in enumerate(UV):
        r, g, b = px[min(W - 1, int((u % 1) * W)), min(H - 1, int((v % 1) * H))]
        if r > 100 and r > 1.6 * g and r > 1.6 * b: out.append(i)   # red hue, not tan/green scales, not pale teeth
    return out

root = Path(__file__).resolve().parent.parent / "public"
for p in [root / "models" / "HydraHead.glb", root / "small" / "models" / "HydraHead.glb"]: label(p)
