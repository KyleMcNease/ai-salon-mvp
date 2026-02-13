#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
PID_DIR="$ROOT_DIR/.runtime/pids"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
BACKEND_PORT="8000"
FRONTEND_PORT="3000"

stop_from_pid_file() {
  local label="$1"
  local pid_file="$2"

  if [ ! -f "$pid_file" ]; then
    echo "[skip] ${label}: no pid file"
    return 0
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [ -z "$pid" ]; then
    rm -f "$pid_file"
    echo "[skip] ${label}: empty pid file"
    return 0
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "[stop] ${label} (pid $pid)"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  else
    echo "[skip] ${label}: process not running"
  fi

  rm -f "$pid_file"
}

stop_from_port() {
  local label="$1"
  local port="$2"
  local pattern="$3"
  local pids
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"

  if [ -z "$pids" ]; then
    echo "[skip] ${label}: no listener on port ${port}"
    return 0
  fi

  local matched=0
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    local command_line
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ -n "$pattern" && ! "$command_line" =~ $pattern ]]; then
      continue
    fi
    matched=1
    echo "[stop] ${label} via port ${port} (pid $pid)"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  done <<<"$pids"

  if [ "$matched" -eq 0 ]; then
    echo "[skip] ${label}: listener found on ${port}, but command did not match ${pattern}"
  fi
}

main() {
  echo "== Stopping SCRIBE =="
  stop_from_pid_file "Backend" "$BACKEND_PID_FILE"
  stop_from_pid_file "Frontend" "$FRONTEND_PID_FILE"
  stop_from_port "Backend" "$BACKEND_PORT" "uvicorn apps\\.scribe_api\\.app:app|python3 -m uvicorn apps\\.scribe_api\\.app:app"
  stop_from_port "Frontend" "$FRONTEND_PORT" "next dev|npm run dev"
  echo "Done."
}

main "$@"
