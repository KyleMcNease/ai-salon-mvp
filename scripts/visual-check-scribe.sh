#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
SCREENSHOT_DIR="$RUNTIME_DIR/screenshots"
URL="${SCRIBE_URL:-http://127.0.0.1:3000}"
WINDOW_SIZE="${SCRIBE_SCREENSHOT_SIZE:-1728,1117}"

mkdir -p "$SCREENSHOT_DIR"

echo "== SCRIBE visual check =="
echo "[step] Restarting app"
"$ROOT_DIR/scripts/stop-scribe-app.sh" >/dev/null 2>&1 || true
"$ROOT_DIR/scripts/launch-scribe-app.sh" >/dev/null 2>&1

echo "[step] Waiting for $URL"
for _ in $(seq 1 120); do
  if curl --silent --fail --max-time 2 "$URL" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl --silent --fail --max-time 2 "$URL" >/dev/null 2>&1; then
  echo "[error] SCRIBE frontend did not become ready at $URL"
  exit 1
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
output_file="$SCREENSHOT_DIR/scribe-$timestamp.png"

CHROME_BIN=""
if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v google-chrome >/dev/null 2>&1; then
  CHROME_BIN="$(command -v google-chrome)"
elif command -v chromium >/dev/null 2>&1; then
  CHROME_BIN="$(command -v chromium)"
fi

if [ -z "$CHROME_BIN" ]; then
  echo "[error] Could not find a Chrome/Chromium binary for headless screenshot capture."
  echo "        Install Chrome or set a compatible binary on PATH."
  exit 1
fi

echo "[step] Capturing screenshot"
"$CHROME_BIN" \
  --headless=new \
  --disable-gpu \
  --hide-scrollbars \
  --window-size="$WINDOW_SIZE" \
  --screenshot="$output_file" \
  "$URL" >/dev/null 2>&1

echo "[ok] Screenshot saved: $output_file"
