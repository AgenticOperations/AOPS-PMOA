---
created: 2026-08-10
project: agentOps
tags: [fleet-sellers, ngrok, nginx, production]
status: operator guide
---

# Tunnel local fleet sellers into production Chat

Run sellers on your laptop, put **nginx** in front (one port), expose with **ngrok** (or cloudflared), and let production Chat pay those URLs.

```text
Production Chat / API
        │  HTTPS
        ▼
  https://xxxx.ngrok-free.app/data|/analysis|/report|/review
        │
        ▼
  nginx :8088  (demo/fleet-sellers.nginx.conf)
        ├── /data      → 127.0.0.1:4001 DataFetcher
        ├── /analysis  → 127.0.0.1:4002 Analyst
        ├── /report    → 127.0.0.1:4003 Writer
        └── /review    → 127.0.0.1:4004 SeniorReviewer
```

## Prerequisites

- Fleet agents exist in the **production** org (Orchestrator, DataFetcher, Analyst, Writer, SeniorReviewer) with wallets
- Local machine can reach **production** `DATABASE_URL` (same Postgres the API uses)
- `nginx` installed (`brew install nginx`)
- `ngrok` or `cloudflared`

## Steps

### 1. Point local env at production DB (**required**)

Your `apps/api/.env` still had `DATABASE_URL=…localhost…` while calling Railway — that yields `Operator context is required` because the seller script seeds a session into local Postgres and production cannot read it.

In the shell (prefer export over editing local `.env` permanently):

```bash
export DATABASE_URL='postgres://…Railway production…'   # same DB as the API service
export ARC_RPC_URL=https://rpc.testnet.arc.network
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
# optional force org (production org id from console):
# export DEMO_ORG_ID=org_…
```

### 2. Start sellers + nginx (point at production API)

```bash
cd AOPS-PMOA
chmod +x demo/run-sellers-tunnel.sh

AGENTOPS_API_BASE_URL=https://agentops-pmoaapi-production.up.railway.app \
./demo/run-sellers-tunnel.sh
```

The script exits early if DB is loopback and API is remote.

Leave this running. Confirm:

```bash
curl -s http://127.0.0.1:4001/healthz
curl -s http://127.0.0.1:8088/healthz
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:8088/data?q=fleet-run'   # expect 402
```

### 3. Tunnel port 8088

```bash
ngrok http 8088
# or: cloudflared tunnel --url http://127.0.0.1:8088
```

Copy the `https://….ngrok-free.app` URL.

### 4. Restart sellers with the public URL (publishes agent endpoints)

```bash
AGENTOPS_API_BASE_URL=https://YOUR-PRODUCTION-API \
FLEET_SELLERS_PUBLIC_BASE=https://YOUR.ngrok-free.app \
FLEET_SELLERS_URL_MODE=paths \
./demo/run-sellers-tunnel.sh
```

Logs should show `published https://YOUR.ngrok-free.app/data` etc.

### 5. Production API env

```bash
MARKETPLACE_DEMO_HOST=https://YOUR.ngrok-free.app
FLEET_SELLERS_URL_MODE=paths
FLEET_REQUIRE_LIVE_SELLERS=true
```

Redeploy/restart the API.

### 6. Chat

Open production `/chat` in the org sellers bound to → run the fleet → Activity should show live Permit2 txs.

## Notes

- Keep the laptop + ngrok + sellers process up while you demo.
- Free ngrok URLs change on restart — repeat steps 3–5 when the URL changes.
- `DEMO_ORG_ID` is optional; sellers auto-pick an org with the full fleet if unset.
- Path mode is required for a single HTTPS origin (ngrok does not expose `:4001–4004` separately).
