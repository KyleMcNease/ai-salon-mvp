#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"

BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8000"
FRONTEND_HOST="127.0.0.1"
FRONTEND_PORT="3000"
BACKEND_URL="http://${BACKEND_HOST}:${BACKEND_PORT}"
FRONTEND_URL="http://${FRONTEND_HOST}:${FRONTEND_PORT}"

BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"

mkdir -p "$LOG_DIR" "$PID_DIR"

is_up() {
  local url="$1"
  curl --silent --fail --max-time 2 "$url" >/dev/null 2>&1
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"

  if grep -q "^${key}=" "$file"; then
    if [[ "${OSTYPE:-}" == darwin* ]]; then
      sed -i '' "s|^${key}=.*|${key}=${value}|" "$file"
    else
      sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    fi
  else
    printf "%s=%s\n" "$key" "$value" >>"$file"
  fi
}

ensure_frontend_env() {
  local env_file="$ROOT_DIR/frontend/.env.local"
  touch "$env_file"
  set_env_value "$env_file" "NEXT_PUBLIC_API_URL" "$BACKEND_URL"
  if ! grep -q "^NEXT_PUBLIC_RESEARCH_APP_URL=" "$env_file"; then
    printf "NEXT_PUBLIC_RESEARCH_APP_URL=http://127.0.0.1:3001\n" >>"$env_file"
  fi
}

wait_for_service() {
  local label="$1"
  local url="$2"
  local max_wait="${3:-90}"
  local elapsed=0

  while (( elapsed < max_wait )); do
    if is_up "$url"; then
      echo "[ok] ${label} ready at ${url}"
      return 0
    fi
    sleep 1
    ((elapsed+=1))
  done

  echo "[error] ${label} did not become ready within ${max_wait}s"
  return 1
}

record_listener_pid() {
  local port="$1"
  local pid_file="$2"
  local pid
  pid="$(lsof -ti tcp:\"$port\" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [ -n "$pid" ]; then
    echo "$pid" >"$pid_file"
  fi
}

start_backend() {
  if is_up "$BACKEND_URL/api/models"; then
    echo "[skip] Backend already running"
    return 0
  fi

  local -a cmd
  if command -v uv >/dev/null 2>&1; then
    cmd=(uv run uvicorn apps.scribe_api.app:app --host "$BACKEND_HOST" --port "$BACKEND_PORT")
  elif python3 -c "import uvicorn" >/dev/null 2>&1; then
    cmd=(python3 -m uvicorn apps.scribe_api.app:app --host "$BACKEND_HOST" --port "$BACKEND_PORT")
  else
    echo "[error] Neither 'uv' nor python uvicorn is available."
    echo "        Install deps first: pip install -e ."
    exit 1
  fi

  echo "[start] Backend"
  (
    cd "$ROOT_DIR"
    nohup "${cmd[@]}" >"$BACKEND_LOG" 2>&1 &
    echo $! >"$BACKEND_PID_FILE"
  )
}

start_frontend() {
  if is_up "$FRONTEND_URL"; then
    echo "[skip] Frontend already running"
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "[error] npm is required to run the frontend"
    exit 1
  fi

  if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
    echo "[setup] Installing frontend dependencies (first run)"
    npm --prefix "$ROOT_DIR/frontend" install
  fi

  echo "[start] Frontend"
  (
    cd "$ROOT_DIR/frontend"
    nohup env NEXT_PUBLIC_API_URL="$BACKEND_URL" npm run dev -- --hostname "$FRONTEND_HOST" --port "$FRONTEND_PORT" >"$FRONTEND_LOG" 2>&1 &
    echo $! >"$FRONTEND_PID_FILE"
  )
}

open_app() {
  if command -v open >/dev/null 2>&1; then
    open "$FRONTEND_URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$FRONTEND_URL" >/dev/null 2>&1 || true
  fi
}

main() {
  echo "== SCRIBE launcher =="
  echo "repo: $ROOT_DIR"

  ensure_frontend_env
  start_backend
  start_frontend

  wait_for_service "Backend" "$BACKEND_URL/api/models" 90
  wait_for_service "Frontend" "$FRONTEND_URL" 120
  record_listener_pid "$BACKEND_PORT" "$BACKEND_PID_FILE"
  record_listener_pid "$FRONTEND_PORT" "$FRONTEND_PID_FILE"

  open_app

  cat <<MSG

SCRIBE is up.
- UI:      $FRONTEND_URL
- Backend: $BACKEND_URL
- Logs:
  - $BACKEND_LOG
  - $FRONTEND_LOG

To stop, run: $ROOT_DIR/scripts/stop-scribe-app.sh
MSG
}

main "$@"
