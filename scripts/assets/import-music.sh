#!/usr/bin/env bash
# Import the three music loops (see docs/MUSIC.md) into public/music.
# Usage: scripts/assets/import-music.sh theme.mp3 cruise.mp3 tension.mp3
# Each is trimmed to 40 s with a short fade at the loop point, made mono at 48 kbps
# so all three fit the single-file artifact's 16 MB budget (~1 MB for music).
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p public/music
ids=(theme cruise tension)
listed=()
for i in 0 1 2; do
  src="${@:$((i + 1)):1}"
  [ -n "$src" ] || continue
  ffmpeg -loglevel error -y -i "$src" -t 40 -af "afade=t=in:d=0.05,afade=t=out:st=39.6:d=0.4" -ac 1 -b:a 48k "public/music/${ids[$i]}.mp3"
  listed+=("\"${ids[$i]}\"")
  echo "public/music/${ids[$i]}.mp3 $(du -h "public/music/${ids[$i]}.mp3" | cut -f1)"
done
(IFS=,; echo "[${listed[*]}]") > public/music/tracks.json
echo "tracks.json: $(cat public/music/tracks.json)"
