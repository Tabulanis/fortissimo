#!/usr/bin/env bash
# play.sh — run Fortissimo from a downloaded copy (Linux / macOS). Double-click it, or: ./play.sh
#   first run: installs what the game needs (a few minutes), builds it, opens it in your browser
#   after that: starts in seconds. Close this window to stop the game.
cd "$(dirname "$0")"
PORT="${PORT:-5180}"
say() { printf '\n\033[1;33m%s\033[0m\n' "$*"; }
if ! command -v node >/dev/null 2>&1; then
  say "Fortissimo needs Node.js (free) to run from source."
  echo "Install it from https://nodejs.org (the LTS version), then run this again."
  read -rp "Press Enter to close." _; exit 1
fi
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  say "First run: installing what the game needs (one time, a few minutes)…"
  # the desktop-app tooling isn't needed to play: skip its big download
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --no-audit --no-fund || { say "Install failed — see above."; read -rp "Press Enter to close." _; exit 1; }
fi
if [ ! -f dist/index.html ] || [ -n "$(find src public index.html -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  say "Building the game…"
  npm run build --silent || { say "Build failed — see above."; read -rp "Press Enter to close." _; exit 1; }
fi
say "Fortissimo is running at http://localhost:$PORT  — close this window to stop it."
OPEN=--open; [ -n "$NO_OPEN" ] && OPEN=
exec npx vite preview --port "$PORT" --strictPort $OPEN
