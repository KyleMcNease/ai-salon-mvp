#!/bin/bash
set -euo pipefail

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "This installer is for macOS only."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
DESKTOP_DIR="$HOME/Desktop"
START_COMMAND="$DESKTOP_DIR/SCRIBE.command"
STOP_COMMAND="$DESKTOP_DIR/SCRIBE Stop.command"
START_APP="$DESKTOP_DIR/SCRIBE.app"
STOP_APP="$DESKTOP_DIR/SCRIBE Stop.app"

cat >"$START_COMMAND" <<CMD
#!/bin/bash
cd "$ROOT_DIR"
./scripts/launch-scribe-app.sh
CMD

cat >"$STOP_COMMAND" <<CMD
#!/bin/bash
cd "$ROOT_DIR"
./scripts/stop-scribe-app.sh
CMD

chmod +x "$START_COMMAND" "$STOP_COMMAND"

if command -v osacompile >/dev/null 2>&1; then
  rm -rf "$START_APP" "$STOP_APP"

  osacompile -o "$START_APP" -e 'on run' -e 'tell application "Terminal"' -e 'activate' -e "do script \"cd $(printf '%q' "$ROOT_DIR") && ./scripts/launch-scribe-app.sh\"" -e 'end tell' -e 'end run'
  osacompile -o "$STOP_APP" -e 'on run' -e 'tell application "Terminal"' -e 'activate' -e "do script \"cd $(printf '%q' "$ROOT_DIR") && ./scripts/stop-scribe-app.sh\"" -e 'end tell' -e 'end run'

  echo "Created app icons:"
  echo "- $START_APP"
  echo "- $STOP_APP"
fi

echo "Created desktop launchers:"
echo "- $START_COMMAND"
echo "- $STOP_COMMAND"
