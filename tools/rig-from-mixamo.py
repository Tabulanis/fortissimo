#!/usr/bin/env python3
"""rig-from-mixamo.py — give an UNRIGGED T-pose humanoid (the owner's Minotaur) the
skeleton and animation clips of an already-rigged Mixamo model (the Sentinel), so it
walks, runs and swings exactly like it (owner, 2026-10-07: "rig it with the same animations").

How:
  1. the donor's bind-pose joint positions (from its inverse bind matrices) are FITTED into the
     target mesh: bone DIRECTIONS stay the donor's (so its clips play unchanged), bone LENGTHS
     and centres come from the target — each limb joint is snapped to the centre of the
     target's cross-section there (arms along x, legs and spine along y).
  2. the skeleton keeps the donor's bind rotations; local offsets are recomputed for the new
     positions. Rotation channels are copied as they are; only the Hips keeps a translation
     channel, rescaled to the target's leg length.
  3. SKIN WEIGHTS for the target are computed: distance to each bone's segment, inverse 4th
     power, top 4, left/right kept to their own side, then smoothed over the mesh's edges.
  4. one glb is written: the target mesh (+ its textures) skinned to the new skeleton, with
     every donor clip.
    python3 tools/rig-from-mixamo.py <donor.glb> <target.glb> <out.glb>
"""
import json, struct, sys
import numpy as np

donor_p, target_p, out_p = sys.argv[1:4]

def read(p):
    b = open(p, 'rb').read(); n = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + n]); blen = struct.unpack_from('<I', b, 20 + n)[0]
    return j, b[28 + n:28 + n + blen]
COMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
DT = {5126: '<f4', 5123: '<u2', 5125: '<u4', 5121: 'u1'}
def acc(j, bin, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); c = COMP[a['type']]; dt = np.dtype(DT[a['componentType']])
    st = bv.get('byteStride'); sz = dt.itemsize * c
    if st and st != sz:
        return np.array([np.frombuffer(bin, dt, c, off + k * st) for k in range(a['count'])])
    return np.frombuffer(bin, dt, a['count'] * c, off).reshape(a['count'], c).copy()

def qmul(a, b):   # (x, y, z, w)
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return np.array([aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx, aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz])
def qinv(q): return np.array([-q[0], -q[1], -q[2], q[3]])
def qrot(q, v):
    p = np.array([v[0], v[1], v[2], 0.0]); r = qmul(qmul(q, p), qinv(q)); return r[:3]
def mat2q(m):
    m = m[:3, :3]; m = m / np.linalg.norm(m, axis=0)
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = 0.5 / np.sqrt(t + 1); return np.array([(m[2, 1] - m[1, 2]) * s, (m[0, 2] - m[2, 0]) * s, (m[1, 0] - m[0, 1]) * s, 0.25 / s])
    i = int(np.argmax([m[0, 0], m[1, 1], m[2, 2]])); jj, kk = (i + 1) % 3, (i + 2) % 3
    s = 2 * np.sqrt(1 + m[i, i] - m[jj, jj] - m[kk, kk]); q = np.zeros(4)
    q[i] = 0.25 * s; q[jj] = (m[jj, i] + m[i, jj]) / s; q[kk] = (m[kk, i] + m[i, kk]) / s; q[3] = (m[kk, jj] - m[jj, kk]) / s
    return q

# ---------------------------------------------------------------- the donor's skeleton
dj, dbin = read(donor_p); sk = dj['skins'][0]; J = sk['joints']
names = [dj['nodes'][i]['name'] for i in J]; short = [nm.split(':')[-1] for nm in names]
ix = {s: k for k, s in enumerate(short)}
ibm = acc(dj, dbin, sk['inverseBindMatrices']).reshape(-1, 4, 4)
bindW = [np.linalg.inv(m.T) for m in ibm]                      # joint world (mesh space) at bind
Pd = np.array([m[:3, 3] for m in bindW]); Qd = [mat2q(m) for m in bindW]
node2k = {n: k for k, n in enumerate(J)}
parent = [-1] * len(J)
for k, n in enumerate(J):
    for c in dj['nodes'][n].get('children', []):
        if c in node2k: parent[node2k[c]] = k
dpos = acc(dj, dbin, dj['meshes'][0]['primitives'][0]['attributes']['POSITION'])

# ---------------------------------------------------------------- the target mesh
tj, tbin = read(target_p); tprim = tj['meshes'][0]['primitives'][0]
T = acc(tj, tbin, tprim['attributes']['POSITION']).astype(np.float64)
tidx = acc(tj, tbin, tprim['indices']).ravel()
dmin, dmax = dpos.min(0), dpos.max(0); tmin, tmax = T.min(0), T.max(0)
sy = (tmax[1] - tmin[1]) / (dmax[1] - dmin[1])                # height ratio
sx = (tmax[0] - tmin[0]) / (dmax[0] - dmin[0])                # span ratio (arms)
def to_t(p, kx=sx):   # donor point -> target space, by bounding boxes
    return np.array([p[0] * kx, tmin[1] + (p[1] - dmin[1]) * sy, p[2] * ((tmax[2] - tmin[2]) / (dmax[2] - dmin[2]))])

def centroid(mask, keep):   # the centre of a cross-section, along the axes in `keep`
    if mask.sum() < 6: return None
    return T[mask].mean(0)

Pt = np.zeros_like(Pd)
ARM = {'Shoulder', 'Arm', 'ForeArm', 'Hand'}; LEG = {'UpLeg', 'Leg', 'Foot', 'ToeBase'}
def part(s):
    for side in ('Left', 'Right'):
        if s.startswith(side):
            rest = s[len(side):]
            if rest in ARM: return side, 'arm', rest
            if rest in LEG: return side, 'leg', rest
    return None, None, None
for k, s in enumerate(short):
    side, kind, rest = part(s)
    p = to_t(Pd[k])
    if kind == 'arm':
        if rest == 'Shoulder': p = to_t(Pd[k], kx=1.0 + (sx - 1) * 0.5)
        sgn = 1 if side == 'Left' else -1
        m = (np.abs(T[:, 0] - p[0]) < 0.035) & (np.sign(T[:, 0]) == sgn) & (np.abs(T[:, 1] - p[1]) < 0.25)
        c = centroid(m, (1, 2))
        if c is not None: p[1], p[2] = c[1], c[2]
    elif kind == 'leg' and rest != 'ToeBase':
        sgn = 1 if side == 'Left' else -1
        m = (np.abs(T[:, 1] - p[1]) < 0.03) & (np.sign(T[:, 0]) == sgn) & (np.abs(T[:, 0]) < 0.45)
        c = centroid(m, (0, 2))
        if c is not None: p[0], p[2] = c[0], c[2]
    elif s in ('Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'):
        m = (np.abs(T[:, 1] - p[1]) < 0.03) & (np.abs(T[:, 0]) < 0.3)
        c = centroid(m, (0, 2))
        if c is not None: p[0], p[2] = c[0], c[2]
    Pt[k] = p
# everything not fitted above (fingers, toe tips, head ends): the donor's offset from its parent, scaled
for k, s in enumerate(short):
    side, kind, rest = part(s)
    fitted = kind is not None and rest != 'ToeBase' or s in ('Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head')
    if not fitted and parent[k] >= 0:
        sc = sx if ('Hand' in s and kind is None) else sy
        Pt[k] = Pt[parent[k]] + (Pd[k] - Pd[parent[k]]) * sc
# (parents come before children in Mixamo order, so the loop above saw fitted parents first)

# ---------------------------------------------------------------- the new skeleton: donor rotations, target offsets
local_t, local_q = [], []
for k in range(len(J)):
    pk = parent[k]
    if pk < 0: local_t.append(Pt[k]); local_q.append(Qd[k])
    else:
        local_t.append(qrot(qinv(Qd[pk]), Pt[k] - Pt[pk]))
        local_q.append(qmul(qinv(Qd[pk]), Qd[k]))
newIBM = []
for k in range(len(J)):
    W = np.eye(4); R = np.eye(3); q = Qd[k]
    x, y, z, w = q
    R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    W[:3, :3] = R; W[:3, 3] = Pt[k]; newIBM.append(np.linalg.inv(W))

# ---------------------------------------------------------------- skin weights
SKIP = ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky', 'Toe_End', 'HeadTop_End', 'headfront')
cand = [k for k, s in enumerate(short) if not any(t in s for t in SKIP)]
child = {}
for k in cand:
    kids = [c for c in range(len(J)) if parent[c] == k]
    pref = {'Hips': 'Spine', 'Spine2': 'Neck', 'Head': 'HeadTop_End', 'Hand': None}
    want = pref.get(short[k].replace('Left', '').replace('Right', '')) if short[k] in pref or short[k].endswith('Hand') else None
    c = next((c for c in kids if want and short[c].endswith(want)), kids[0] if kids else None)
    child[k] = c
A = np.array([Pt[k] for k in cand]); B = []
for k in cand:
    c = child[k]
    if c is None or short[k].endswith('Hand'):   # hands: a stub toward the fingers' direction
        d = Pt[k] - Pt[parent[k]]; B.append(Pt[k] + d / (np.linalg.norm(d) + 1e-9) * 0.12)
    else: B.append(Pt[c])
B = np.array(B)
side_of = np.array([1 if short[k].startswith('Left') else -1 if short[k].startswith('Right') else 0 for k in cand])
ab = B - A; L2 = (ab * ab).sum(1) + 1e-12
t = np.clip(((T[:, None, :] - A[None]) * ab[None]).sum(2) / L2[None], 0, 1)
d = np.linalg.norm(T[:, None, :] - (A[None] + t[..., None] * ab[None]), axis=2)
vs = np.sign(np.where(np.abs(T[:, 0]) < 0.04, 0, T[:, 0]))
wrong = (side_of[None] != 0) & (vs[:, None] != 0) & (side_of[None] != vs[:, None])
d = np.where(wrong, 1e3, d)
w = 1.0 / (d + 0.02) ** 4
# smooth over the mesh's edges (weights per candidate bone), then keep the top 4
nv = len(T); nb = len(cand)
edges = np.concatenate([tidx.reshape(-1, 3)[:, [0, 1]], tidx.reshape(-1, 3)[:, [1, 2]], tidx.reshape(-1, 3)[:, [2, 0]]])
w = w / w.sum(1, keepdims=True)
for _ in range(3):
    acc_w = np.zeros_like(w); cnt = np.zeros(nv)
    np.add.at(acc_w, edges[:, 0], w[edges[:, 1]]); np.add.at(acc_w, edges[:, 1], w[edges[:, 0]])
    np.add.at(cnt, edges[:, 0], 1); np.add.at(cnt, edges[:, 1], 1)
    w = 0.5 * w + 0.5 * acc_w / np.maximum(cnt, 1)[:, None]
# then a SPATIAL blur: separate shells (the fur mantle over the shoulders, the skirt panels) share no
# edges with the body, so the edge smoothing never reaches them and they tear away when the arms move —
# average each vertex's weights with every vertex within 7 cm, connected or not
try:
    from scipy.spatial import cKDTree
    tree = cKDTree(T); nbrs = tree.query_ball_point(T, r=0.07)
except ImportError:
    nbrs = [np.nonzero(np.linalg.norm(T - T[i], axis=1) < 0.07)[0] for i in range(nv)]
for _ in range(2):
    w = np.array([w[nb].mean(0) for nb in nbrs])
top = np.argsort(-w, axis=1)[:, :4]; tw = np.take_along_axis(w, top, 1); tw = tw / tw.sum(1, keepdims=True)
joints4 = np.array(cand)[top].astype(np.uint16); weights4 = tw.astype(np.float32)

# ---------------------------------------------------------------- write: target glb + skin + skeleton + clips
out = tj; blob = bytearray(tbin)
def add(arr, typ, comp, target=None, minmax=False):
    while len(blob) % 4: blob.append(0)
    data = np.ascontiguousarray(arr).tobytes(); off = len(blob); blob.extend(data)
    bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
    if target: bv['target'] = target
    out['bufferViews'].append(bv)
    a = {'bufferView': len(out['bufferViews']) - 1, 'componentType': comp, 'count': len(arr), 'type': typ}
    if minmax: a['min'] = np.asarray(arr).min(0).tolist(); a['max'] = np.asarray(arr).max(0).tolist()
    out['accessors'].append(a); return len(out['accessors']) - 1
tprim['attributes']['JOINTS_0'] = add(joints4, 'VEC4', 5123, 34962)
tprim['attributes']['WEIGHTS_0'] = add(weights4, 'VEC4', 5126, 34962)
base = len(out['nodes'])
for k in range(len(J)):
    nd = {'name': names[k], 'translation': [float(x) for x in local_t[k]], 'rotation': [float(x) for x in local_q[k]]}
    kids = [base + c for c in range(len(J)) if parent[c] == k]
    if kids: nd['children'] = kids
    out['nodes'].append(nd)
ibm_i = add(np.array([m.T.ravel() for m in newIBM], np.float32), 'MAT4', 5126)
out.setdefault('skins', []).append({'joints': [base + k for k in range(len(J))], 'inverseBindMatrices': ibm_i, 'skeleton': base})
mesh_node = next(i for i, nd in enumerate(out['nodes']) if 'mesh' in nd)
out['nodes'][mesh_node]['skin'] = len(out['skins']) - 1
root = len(out['nodes']); out['nodes'].append({'name': 'Armature', 'children': [mesh_node, base], 'translation': [0.0, float(-tmin[1]), 0.0]})   # feet on y = 0
out['scenes'][out.get('scene', 0)]['nodes'] = [root]
# clips: every rotation channel as it is; the Hips translation rescaled to the target's legs
hips_k = ix['Hips']; leg = (Pt[hips_k][1] - tmin[1]) / (Pd[hips_k][1] - dmin[1])
out['animations'] = []
for an in dj.get('animations', []):
    samplers, channels = [], []
    for ch in an['channels']:
        node = ch['target']['node']
        if node not in node2k: continue
        k = node2k[node]; path = ch['target']['path']
        if path == 'translation' and k != hips_k: continue          # bone lengths are the target's now
        if path == 'scale': continue
        s = an['samplers'][ch['sampler']]
        times = acc(dj, dbin, s['input']).astype(np.float32); vals = acc(dj, dbin, s['output']).astype(np.float32)
        if path == 'translation':   # hips: around the target's hip height, motion scaled by leg length
            vals = (Pt[hips_k] + (vals - Pd[hips_k]) * leg).astype(np.float32)
        ti = add(times, 'SCALAR', 5126, minmax=True); vi = add(vals, 'VEC3' if path == 'translation' else 'VEC4', 5126)
        samplers.append({'input': ti, 'output': vi, 'interpolation': s.get('interpolation', 'LINEAR')})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': base + k, 'path': path}})
    out['animations'].append({'name': an.get('name', 'clip'), 'samplers': samplers, 'channels': channels})
while len(blob) % 4: blob.append(0)
out['buffers'] = [{'byteLength': len(blob)}]
jb = json.dumps(out, separators=(',', ':')).encode(); jb += b' ' * (-len(jb) % 4)
open(out_p, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jb) + 8 + len(blob)) + struct.pack('<I', len(jb)) + b'JSON' + jb + struct.pack('<I', len(blob)) + b'BIN\0' + bytes(blob))
print(f'wrote {out_p}: {len(T)} verts, {len(J)} joints, {len(out["animations"])} clips {[a["name"] for a in out["animations"]]}')
for s in ('Hips', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot'):
    print(f'  {s:12s} donor {np.round(Pd[ix[s]], 2)}  target {np.round(Pt[ix[s]], 2)}')
