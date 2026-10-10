#!/bin/bash
# store-shots.sh — STORE SCREENSHOTS (10-09): 1920x1080 photos of the real game at each station, High graphics, into store/shots/.
# Needs the dev server on :5180 and the photo sink (scratchpad/sink.py on :8899). Re-run after any look change.
S=/tmp/fortissimo-dev "$(dirname "$0")/.." && mkdir -p store/shots
for face in drums bass treble sea; do
  mkdir -p $S/ffst && cp $S/ffp/user.js $S/ffst/
  timeout 45 ~/.local/opt/firefox/firefox --headless --no-remote --window-size 1920,1080 --profile $S/ffst "http://127.0.0.1:5180/?shot=16&quality=high&face=$face&tag=store" >/dev/null 2>&1
  for p in $(ls /proc | grep -E '^[0-9]+$'); do ls -l /proc/$p/fd 2>/dev/null | grep -q "$S/ffst/" && kill $p; done; sleep 1; rm -rf $S/ffst
  [ -f "$S/game-$face-store.png" ] && mv "$S/game-$face-store.png" "store/shots/$face.png" && echo "store/shots/$face.png"
done
