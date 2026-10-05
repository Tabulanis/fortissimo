#!/usr/bin/env bash
# Write an Opus .ogg beside every WAV under public/rounds/samples (the game loads
# the .ogg first and falls back to the .wav). ~1/25 the bytes, same onset — Opus
# pre-skip is trimmed by decodeAudioData. Re-run any time; only stale/missing ones are redone.
set -e
cd "$(dirname "$0")/../public/rounds/samples"
n=0
for w in */*.wav; do
  o="${w%.wav}.ogg"
  [ "$o" -nt "$w" ] && continue          # already converted and newer than the WAV
  ffmpeg -v error -y -i "$w" -c:a libopus -b:a 96k "$o"
  n=$((n+1))
done
echo "converted $n; sizes: wav $(du -ch */*.wav | tail -1 | cut -f1), ogg $(du -ch */*.ogg | tail -1 | cut -f1)"
