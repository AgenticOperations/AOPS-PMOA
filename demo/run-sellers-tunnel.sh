#!/usr/bin/env bash
# Local sellers + nginx path gateway for production Chat (ngrok/cloudflared).
#
# Usage:
#   1) DATABASE_URL = production Postgres (NOT localhost)
#   2) AGENTOPS_API_BASE_URL=https://YOUR-PRODUCTION-API
#   3) ./demo/run-sellers-tunnel.sh
#   4) ngrok http 8088  → copy https URL
#   5) FLEET_SELLERS_PUBLIC_BASE=https://….ngrok-free.app ./demo/run-sellers-tunnel.sh
#   6) Production API: same host + FLEET_SELLERS_URL_MODE=paths + FLEET_REQUIRE_LIVE_SELLERS=true
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${DATABASE_URL:-}" && -f apps/api/.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source apps/api/.env
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL required (use production DB so agent wallets/endpoints match Chat)}"
: "${ARC_RPC_URL:?ARC_RPC_URL required}"

export FLEET_SELLERS_HOST="${FLEET_SELLERS_HOST:-0.0.0.0}"
export FLEET_SELLERS_URL_MODE="${FLEET_SELLERS_URL_MODE:-paths}"
export FLEET_SELLERS_OPTIONAL="${FLEET_SELLERS_OPTIONAL:-0}"

# Prefer explicit production API. Do not silently use dead localhost:8080.
if [[ -z "${AGENTOPS_API_BASE_URL:-}" ]]; then
  AGENTOPS_API_BASE_URL="${PUBLIC_API_BASE_URL:-${AGENTOPS_PUBLIC_API_BASE_URL:-}}"
fi
if [[ -z "${AGENTOPS_API_BASE_URL:-}" || "${AGENTOPS_API_BASE_URL}" == "http://127.0.0.1:8080" || "${AGENTOPS_API_BASE_URL}" == "http://localhost:8080" ]]; then
  if ! curl -sf --connect-timeout 2 "${AGENTOPS_API_BASE_URL:-http://127.0.0.1:8080}/healthz" >/dev/null 2>&1; then
    echo "[run-sellers-tunnel] AgentOps API is not reachable on localhost:8080."
    echo "  Sellers need the API to mint an Analyst credential (second-hop)."
    echo "  Set your production API, then re-run:"
    echo "    AGENTOPS_API_BASE_URL=https://YOUR-PRODUCTION-API ./demo/run-sellers-tunnel.sh"
    exit 1
  fi
fi
export AGENTOPS_API_BASE_URL="${AGENTOPS_API_BASE_URL:-http://127.0.0.1:8080}"
echo "[run-sellers-tunnel] API base: $AGENTOPS_API_BASE_URL"

# Catch the common mismatch early (local DB + remote API → Operator context required).
DB_HOST="$(node -e "try{console.log(new URL(process.env.DATABASE_URL).hostname)}catch{console.log('')}" )"
API_HOST="$(node -e "try{console.log(new URL(process.env.AGENTOPS_API_BASE_URL).hostname)}catch{console.log('')}" )"
is_loopback() {
  case "$1" in localhost|127.0.0.1|::1|0.0.0.0) return 0 ;; *) return 1 ;; esac
}
if ! is_loopback "$API_HOST" && is_loopback "$DB_HOST"; then
  echo "[run-sellers-tunnel] DATABASE_URL is ${DB_HOST} but API is ${AGENTOPS_API_BASE_URL}."
  echo "  Sessions written to local Postgres are invisible to production → \"Operator context is required.\""
  echo "  Export production DATABASE_URL (Railway Postgres), then re-run."
  exit 1
fi
echo "[run-sellers-tunnel] DB host: $DB_HOST"

# Loopback public bases are invisible to Railway — never publish them as agent endpoints.
is_loopback_url() {
  case "$1" in
    http://127.0.0.1|http://127.0.0.1:*|http://localhost|http://localhost:*|https://127.0.0.1|https://127.0.0.1:*|https://localhost|https://localhost:*)
      return 0 ;;
    *) return 1 ;;
  esac
}
PUBLIC_CANDIDATE="${FLEET_SELLERS_PUBLIC_BASE:-}"
if [[ -n "$PUBLIC_CANDIDATE" ]] && is_loopback_url "$PUBLIC_CANDIDATE"; then
  echo "[run-sellers-tunnel] ignoring loopback FLEET_SELLERS_PUBLIC_BASE=$PUBLIC_CANDIDATE (Railway cannot reach it)"
  PUBLIC_CANDIDATE=""
fi
if [[ -z "$PUBLIC_CANDIDATE" && -n "${MARKETPLACE_DEMO_HOST:-}" ]]; then
  if is_loopback_url "$MARKETPLACE_DEMO_HOST"; then
    echo "[run-sellers-tunnel] ignoring loopback MARKETPLACE_DEMO_HOST=$MARKETPLACE_DEMO_HOST"
  else
    PUBLIC_CANDIDATE="$MARKETPLACE_DEMO_HOST"
  fi
fi
if [[ -z "$PUBLIC_CANDIDATE" ]]; then
  if ! is_loopback "$API_HOST"; then
    echo "[run-sellers-tunnel] ERROR: production API needs a public seller URL."
    echo "  1) Keep sellers/nginx running, in another terminal:  ngrok http 8088"
    echo "  2) Re-run with the https URL:"
    echo "     FLEET_SELLERS_PUBLIC_BASE=https://YOUR.ngrok-free.app \\"
    echo "     AGENTOPS_API_BASE_URL=$AGENTOPS_API_BASE_URL \\"
    echo "     ./demo/run-sellers-tunnel.sh"
    echo "  Until then Chat sees offline sellers and returns catalog/fixture answers (not live LLM+payments)."
    exit 1
  fi
  export FLEET_SELLERS_PUBLIC_BASE="http://127.0.0.1:8088"
else
  export FLEET_SELLERS_PUBLIC_BASE="$PUBLIC_CANDIDATE"
fi
export MARKETPLACE_DEMO_HOST="$FLEET_SELLERS_PUBLIC_BASE"

NGINX_BIN="$(command -v nginx || true)"
if [[ -z "$NGINX_BIN" ]]; then
  echo "[run-sellers-tunnel] nginx not found. Install: brew install nginx"
  exit 1
fi

echo "[run-sellers-tunnel] starting nginx gateway on :8088"
"$NGINX_BIN" -c "$ROOT/demo/fleet-sellers.nginx.conf" -g 'daemon off;' &
NGINX_PID=$!

cleanup() {
  kill "$NGINX_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[run-sellers-tunnel] starting fleet sellers (url mode=paths, public=$FLEET_SELLERS_PUBLIC_BASE)"
node demo/start-fleet-sellers.mjs
