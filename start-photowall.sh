#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"

SERVER_LOG="$LOG_DIR/server.log"
CLIENT_LOG="$LOG_DIR/client.log"
TUNNEL_LOG="$LOG_DIR/tunnel.log"

SERVER_CMD=(npm run dev:server)
CLIENT_CMD=(npm run dev:client -- --strictPort)
TUNNEL_CMD=(cloudflared tunnel run photowall)

SERVER_PORT=3001
CLIENT_PORT=3000
TUNNEL_PATTERN='cloudflared tunnel run photowall'

mkdir -p "$LOG_DIR"

ensure_project_root() {
  cd "$ROOT_DIR"
}

is_pid_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

lsof_pids() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

pattern_pids() {
  local pattern="$1"
  pgrep -f "$pattern" 2>/dev/null || true
}

stop_pids() {
  local name="$1"
  local pids_raw="${2:-}"
  local -a pids=()

  while IFS= read -r line; do
    [[ -n "$line" ]] && pids+=("$line")
  done <<< "$pids_raw"

  if [[ "${#pids[@]}" -eq 0 ]]; then
    echo "$name is not running"
    return 0
  fi

  echo "Stopping $name: ${pids[*]}"
  kill "${pids[@]}" 2>/dev/null || true
  sleep 1
  for pid in "${pids[@]}"; do
    if is_pid_running "$pid"; then
      echo "$name PID $pid did not exit cleanly, sending SIGKILL..."
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

start_process() {
  local name="$1"
  local log_file="$2"
  shift 2
  local launcher_pid

  echo "Starting $name..."
  nohup "$@" >> "$log_file" 2>&1 &
  launcher_pid=$!
  sleep 1

  if is_pid_running "$launcher_pid"; then
    echo "$name launcher started (PID $launcher_pid)"
    return 0
  fi

  echo "Failed to start $name. Check $log_file"
  return 1
}

print_status_line() {
  local name="$1"
  local description="$2"
  if [[ -n "$description" ]]; then
    echo "$name: running ($description)"
  else
    echo "$name: stopped"
  fi
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local max_attempts="${3:-30}"

  for ((i = 1; i <= max_attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name is ready: $url"
      return 0
    fi
    sleep 1
  done

  echo "$name did not become ready in time: $url"
  return 1
}

start_all() {
  ensure_project_root
  if [[ -n "$(lsof_pids "$SERVER_PORT")" ]]; then
    echo "backend is already listening on port $SERVER_PORT"
  else
    start_process "backend" "$SERVER_LOG" "${SERVER_CMD[@]}"
  fi
  wait_for_http "Backend API" "http://localhost:3001/photowall/api/stats"

  if [[ -n "$(lsof_pids "$CLIENT_PORT")" ]]; then
    echo "frontend is already listening on port $CLIENT_PORT"
  else
    start_process "frontend" "$CLIENT_LOG" "${CLIENT_CMD[@]}"
  fi
  wait_for_http "Frontend" "http://localhost:3000/photowall/"

  if [[ -n "$(pattern_pids "$TUNNEL_PATTERN")" ]]; then
    echo "tunnel is already running"
  else
    start_process "tunnel" "$TUNNEL_LOG" "${TUNNEL_CMD[@]}"
  fi

  echo ""
  echo "Local URLs:"
  echo "  Frontend: http://localhost:3000/photowall/"
  echo "  Backend:  http://localhost:3001/photowall/api"
  echo ""
  echo "Logs:"
  echo "  $SERVER_LOG"
  echo "  $CLIENT_LOG"
  echo "  $TUNNEL_LOG"
}

stop_all() {
  local tunnel_pids_raw client_pids_raw server_pids_raw

  tunnel_pids_raw="$(pattern_pids "$TUNNEL_PATTERN")"
  client_pids_raw="$(lsof_pids "$CLIENT_PORT")"
  server_pids_raw="$(lsof_pids "$SERVER_PORT")"

  stop_pids "tunnel" "$tunnel_pids_raw"
  stop_pids "frontend" "$client_pids_raw"
  stop_pids "backend" "$server_pids_raw"
}

status_all() {
  local server_pids client_pids tunnel_pids

  server_pids="$(lsof_pids "$SERVER_PORT" | tr '\n' ' ' | xargs)"
  client_pids="$(lsof_pids "$CLIENT_PORT" | tr '\n' ' ' | xargs)"
  tunnel_pids="$(pattern_pids "$TUNNEL_PATTERN" | tr '\n' ' ' | xargs)"

  print_status_line "backend" "${server_pids:+port $SERVER_PORT, PID(s) $server_pids}"
  print_status_line "frontend" "${client_pids:+port $CLIENT_PORT, PID(s) $client_pids}"
  print_status_line "tunnel" "${tunnel_pids:+PID(s) $tunnel_pids}"
}

restart_all() {
  stop_all
  start_all
}

usage() {
  cat <<'EOF'
Usage: ./start-photowall.sh [start|stop|restart|status]

Commands:
  start    Start backend, frontend, and cloudflared tunnel
  stop     Stop all managed processes
  restart  Restart all managed processes
  status   Show current process status
EOF
}

COMMAND="${1:-start}"

case "$COMMAND" in
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  restart)
    restart_all
    ;;
  status)
    status_all
    ;;
  *)
    usage
    exit 1
    ;;
esac
