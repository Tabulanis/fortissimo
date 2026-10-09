#!/bin/bash
# make-ktx-assets.sh — GPU-COMPRESSED copies of every model (10-09 speed pass, stolen from the big engines): public/models/X.glb →
# public/ktx/models/X.glb with KTX2 textures — colour in ETC1S (small), normal maps in UASTC (no blotchy bumps). They stay
# compressed ON the graphics chip (~4-6x less GPU memory than a jpeg/png, which unpacks to raw pixels). Medium and phones load these
# (stage3d's URL modifier). Needs the Khronos KTX tools (~/.local/opt/KTX-Software-*/bin) and @gltf-transform/cli (dev dep).
# Re-run after any model changes; only stale ones are redone.
set -e
cd "$(dirname "$0")/.."
export PATH="$(ls -d $HOME/.local/opt/KTX-Software-*/bin | tail -1):$PATH"
mkdir -p public/ktx/models
for src in public/models/*.glb; do
  out="public/ktx/models/$(basename "$src")"
  [ -f "$out" ] && [ "$out" -nt "$src" ] && continue
  tmp="$(mktemp --suffix=.glb)"
  npx gltf-transform uastc "$src" "$tmp" --slots "normalTexture" --level 2 --zstd 18 >/dev/null
  npx gltf-transform etc1s "$tmp" "$out" --quality 192 >/dev/null
  rm -f "$tmp"; echo "ktx: $(basename "$src")"
done
# the list the game checks before asking for a compressed copy (a model added later with no copy yet just loads its original)
ls public/ktx/models/*.glb | xargs -n1 basename | python3 -c "import sys, json; print(json.dumps(sorted(l.strip() for l in sys.stdin if l.strip())))" > src/scene/ktx-list.json
