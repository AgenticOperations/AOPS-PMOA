#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_ENV="$ROOT_DIR/apps/api/.env"
WEB_ENV="$ROOT_DIR/apps/web/.env.local"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
RUN_ONLY=false
SERVICE_NAMES=()
SERVICE_PIDS=()
FAILED_SERVICE_NAME=''
FAILED_SERVICE_STATUS=''

usage() {
  cat <<'EOF'
Usage: ./setup.sh [--run-only]

Without arguments:
  - validates Node, npm, and Docker when local infrastructure is needed
  - creates missing env files and asks for required external credentials
  - generates internal Circle worker encryption/authentication secrets
  - starts local Postgres and Redis, installs dependencies, and builds shared packages
  - starts web (3005), Hosted MCP (8070), API (8080), and Circle worker (8090)

--run-only:
  validates the existing installation and env files, then starts the four application services.
  It does not create env files or install/build dependencies.
EOF
}

if [[ "${AGENTOPS_SETUP_LIB_ONLY:-false}" != true ]]; then
  case "${1:-}" in
    '') ;;
    --run-only) RUN_ONLY=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
fi

log() { printf '\n[agentOps] %s\n' "$*"; }
fail() { printf '\n[agentOps] ERROR: %s\n' "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required. $2"
}

validate_node() {
  require_command node 'Install Node.js 22.13.0 or newer.'
  require_command npm 'npm must be available with Node.js.'
  node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 13)) {
      console.error(`Node ${process.versions.node} is unsupported; install Node 22.13.0 or newer.`);
      process.exit(1);
    }
  ' || exit 1
}

env_get() {
  node "$ROOT_DIR/scripts/env-file.mjs" get "$1" "$2"
}

env_set() {
  printf '%s' "$3" | node "$ROOT_DIR/scripts/env-file.mjs" set "$1" "$2"
}

prompt_required() {
  local file="$1" key="$2" label="$3" secret="${4:-false}" value
  value="$(env_get "$file" "$key")"
  if [[ -n "$value" ]]; then return; fi
  while [[ -z "$value" ]]; do
    if [[ "$secret" == true ]]; then
      read -r -s -p "$label: " value
      printf '\n'
    else
      read -r -p "$label: " value
    fi
  done
  env_set "$file" "$key" "$value"
}

generate_internal_secrets() {
  local value
  value="$(env_get "$API_ENV" CIRCLE_PROFILE_MASTER_KEY)"
  if [[ -z "$value" ]]; then
    value="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))")"
    env_set "$API_ENV" CIRCLE_PROFILE_MASTER_KEY "$value"
    log 'Generated CIRCLE_PROFILE_MASTER_KEY in apps/api/.env.'
  fi
  value="$(env_get "$API_ENV" CIRCLE_WORKER_TOKEN)"
  if [[ -z "$value" ]]; then
    value="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
    env_set "$API_ENV" CIRCLE_WORKER_TOKEN "$value"
    log 'Generated CIRCLE_WORKER_TOKEN in apps/api/.env.'
  fi
  chmod 600 "$API_ENV" "$WEB_ENV"
}

prepare_env() {
  if [[ ! -f "$API_ENV" ]]; then
    cp "$ROOT_DIR/apps/api/.env.example" "$API_ENV"
    chmod 600 "$API_ENV"
    log 'Created apps/api/.env from the checked-in template.'
  fi
  if [[ ! -f "$WEB_ENV" ]]; then
    cp "$ROOT_DIR/apps/web/.env.example" "$WEB_ENV"
    chmod 600 "$WEB_ENV"
    log 'Created apps/web/.env.local from the checked-in template.'
  fi

  node "$ROOT_DIR/scripts/env-file.mjs" merge "$API_ENV" "$ROOT_DIR/apps/api/.env.example"
  node "$ROOT_DIR/scripts/env-file.mjs" merge "$WEB_ENV" "$ROOT_DIR/apps/web/.env.example"

  prompt_required "$API_ENV" GOOGLE_CLIENT_ID 'Google OAuth client ID'
  prompt_required "$API_ENV" GOOGLE_CLIENT_SECRET 'Google OAuth client secret' true
  generate_internal_secrets
}

validate_env() {
  [[ -f "$API_ENV" ]] || fail 'apps/api/.env is missing. Run ./setup.sh first.'
  [[ -f "$WEB_ENV" ]] || fail 'apps/web/.env.local is missing. Run ./setup.sh first.'
  if ! node "$ROOT_DIR/scripts/env-file.mjs" validate "$API_ENV" "$WEB_ENV"; then
    fail 'Environment validation failed. Correct the listed values and retry.'
  fi
}

is_local_url() {
  node -e '
    const value = process.argv[1];
    const host = new URL(value).hostname;
    process.exit(["127.0.0.1", "localhost", "::1"].includes(host) ? 0 : 1);
  ' "$1"
}

port_is_open() {
  node -e '
    const net = require("node:net");
    const socket = net.createConnection({ host: process.argv[1], port: Number(process.argv[2]) });
    const done = (code) => { socket.destroy(); process.exit(code); };
    socket.setTimeout(700, () => done(1));
    socket.once("connect", () => done(0));
    socket.once("error", () => done(1));
  ' "$1" "$2"
}

ensure_local_infrastructure() {
  local database_url redis_url database_host database_port redis_host redis_port services=()
  database_url="$(env_get "$API_ENV" DATABASE_URL)"
  redis_url="$(env_get "$API_ENV" REDIS_URL)"

  database_host="$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "$database_url")"
  database_port="$(node -e 'const u=new URL(process.argv[1]);process.stdout.write(u.port || "5432")' "$database_url")"
  redis_host="$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "$redis_url")"
  redis_port="$(node -e 'const u=new URL(process.argv[1]);process.stdout.write(u.port || "6379")' "$redis_url")"

  if is_local_url "$database_url" && ! port_is_open "$database_host" "$database_port"; then services+=(postgres); fi
  if is_local_url "$redis_url" && ! port_is_open "$redis_host" "$redis_port"; then services+=(redis); fi

  if [[ ${#services[@]} -gt 0 ]]; then
    require_command docker 'Install Docker Desktop or point DATABASE_URL and REDIS_URL at reachable services.'
    docker info >/dev/null 2>&1 || fail 'Docker is installed but not running.'
    docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'
    log "Starting local infrastructure: ${services[*]}"
    docker compose -f "$ROOT_DIR/compose.yaml" up -d "${services[@]}"
  fi

  for _ in {1..40}; do
    if port_is_open "$database_host" "$database_port" && port_is_open "$redis_host" "$redis_port"; then return; fi
    sleep 0.5
  done
  fail 'Postgres or Redis did not become reachable.'
}

install_dependencies() {
  log 'Installing locked npm dependencies.'
  if [[ -f "$ROOT_DIR/package-lock.json" ]]; then
    npm ci
  else
    npm install
  fi
  npm exec -- circle --version >/dev/null
  log 'Checking the installed dependency graph for high or critical advisories.'
  npm audit --audit-level=high
  log 'Building shared packages and database migrations.'
  npm run build:packages
}

port_available_for_app() {
  if port_is_open 127.0.0.1 "$1" || port_is_open ::1 "$1"; then
    fail "Port $1 is already in use. Stop the existing process before starting agentOps."
  fi
}

start_service() {
  local name="$1"; shift
  "$@" >"$LOG_DIR/$name.log" 2>&1 &
  SERVICE_NAMES+=("$name")
  SERVICE_PIDS+=("$!")
  printf '%s\n' "$!" >"$RUNTIME_DIR/$name.pid"
}

wait_for_service_health() {
  local label="$1" url="$2" timeout="$3" probe_pid probe_status index pid status
  FAILED_SERVICE_NAME=''
  FAILED_SERVICE_STATUS=''

  node "$ROOT_DIR/scripts/wait-for-http.mjs" "$label" "$url" "$timeout" &
  probe_pid="$!"

  while kill -0 "$probe_pid" 2>/dev/null; do
    for index in "${!SERVICE_PIDS[@]}"; do
      pid="${SERVICE_PIDS[$index]}"
      if ! kill -0 "$pid" 2>/dev/null; then
        if wait "$pid"; then status=0; else status="$?"; fi
        FAILED_SERVICE_NAME="${SERVICE_NAMES[$index]}"
        FAILED_SERVICE_STATUS="$status"
        kill "$probe_pid" 2>/dev/null || true
        wait "$probe_pid" 2>/dev/null || true
        return 1
      fi
    done
    sleep 0.1
  done

  if wait "$probe_pid"; then probe_status=0; else probe_status="$?"; fi
  for index in "${!SERVICE_PIDS[@]}"; do
    pid="${SERVICE_PIDS[$index]}"
    if ! kill -0 "$pid" 2>/dev/null; then
      if wait "$pid"; then status=0; else status="$?"; fi
      FAILED_SERVICE_NAME="${SERVICE_NAMES[$index]}"
      FAILED_SERVICE_STATUS="$status"
      return 1
    fi
  done

  if [[ "$probe_status" -eq 0 ]]; then
    return 0
  fi
  FAILED_SERVICE_NAME="$label health check"
  FAILED_SERVICE_STATUS="$probe_status"
  return 1
}

shutdown() {
  trap - INT TERM EXIT
  if [[ ${#SERVICE_PIDS[@]} -gt 0 ]]; then
    log 'Stopping agentOps services.'
    for pid in "${SERVICE_PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
    for pid in "${SERVICE_PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
  fi
  rm -f "$RUNTIME_DIR"/*.pid
}

show_failure_logs() {
  local file
  for file in "$LOG_DIR"/*.log; do
    [[ -f "$file" ]] || continue
    printf '\n--- %s ---\n' "$(basename "$file")" >&2
    tail -n 40 "$file" >&2
  done
}

start_application() {
  [[ -d "$ROOT_DIR/node_modules" ]] || fail 'Dependencies are not installed. Run ./setup.sh first.'
  port_available_for_app 3005
  port_available_for_app 8070
  port_available_for_app 8080
  port_available_for_app 8090
  mkdir -p "$LOG_DIR"
  rm -f "$LOG_DIR"/*.log "$RUNTIME_DIR"/*.pid
  trap shutdown INT TERM EXIT

  log 'Starting API, Hosted MCP, Circle worker, and web console.'
  start_service api npm run dev:api
  start_service mcp env -u AGENTOPS_MCP_CREDENTIAL NODE_ENV=development AGENTOPS_API_BASE_URL=http://localhost:8080 MCP_HOST=127.0.0.1 MCP_PORT=8070 MCP_PUBLIC_URL=http://127.0.0.1:8070/mcp MCP_ALLOWED_HOSTS=127.0.0.1:8070,localhost:8070 MCP_ALLOWED_ORIGINS=http://localhost:3005 npm run dev:mcp:http
  start_service circle-worker npm run dev:circle-worker
  start_service web env MCP_PUBLIC_URL=http://127.0.0.1:8070/mcp npm --workspace @agentops-pmoa/web run dev -- --port 3005

  if ! wait_for_service_health API http://127.0.0.1:8080/healthz 90000 ||
     ! wait_for_service_health 'Hosted MCP' http://127.0.0.1:8070/healthz 90000 ||
     ! wait_for_service_health 'Circle worker' http://127.0.0.1:8090/healthz 90000 ||
     ! wait_for_service_health Web http://127.0.0.1:3005/ 90000; then
    show_failure_logs
    fail "Startup readiness failed for $FAILED_SERVICE_NAME (status $FAILED_SERVICE_STATUS)."
  fi

  cat <<EOF

agentOps is ready:
  Web:               http://localhost:3005
  Hosted MCP:        http://127.0.0.1:8070/mcp
  Hosted MCP health: http://127.0.0.1:8070/healthz
  API:               http://localhost:8080
  Circle worker:     http://127.0.0.1:8090 (private)
  Logs:              $LOG_DIR

Press Ctrl+C to stop all four application services.
EOF

  while true; do
    for index in "${!SERVICE_PIDS[@]}"; do
      if ! kill -0 "${SERVICE_PIDS[$index]}" 2>/dev/null; then
        if wait "${SERVICE_PIDS[$index]}"; then status=0; else status="$?"; fi
        show_failure_logs
        fail "Service ${SERVICE_NAMES[$index]} stopped unexpectedly with status $status."
      fi
    done
    sleep 2
  done
}

if [[ "${AGENTOPS_SETUP_LIB_ONLY:-false}" == true ]]; then
  return 0 2>/dev/null || exit 0
fi

cd "$ROOT_DIR"
validate_node
if [[ "$RUN_ONLY" == false ]]; then prepare_env; fi
validate_env
ensure_local_infrastructure
if [[ "$RUN_ONLY" == false ]]; then install_dependencies; fi
start_application
