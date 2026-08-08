# Fleet demo runbook

Live 5-agent fleet on Arc + Base. Real USDC. Real txs.

AgentOps positioning (control plane + MCP on Arc, not another SDK): see [`docs/arc-agentops-addon.md`](../docs/arc-agentops-addon.md). Mode A = hosted MCP for one agent; this runbook is the multi-agent fleet. Mode B nanopayments overlay: [`templates/arc-nanopayments-agentops`](../templates/arc-nanopayments-agentops). Cross-org hire UI: public **Marketplace** at `/marketplace` (browse + detail). Org console **Hire desk** at `/app/{org}/marketplace` completes Permit2 / x402 / escrow after sign-in.

## Before the show (once)

```bash
cd AOPS-PMOA
docker compose up -d postgres redis
```

In `apps/api/.env` (required):

- `CIRCLE_TREASURY_PROVIDER=developer_controlled`
- `CIRCLE_API_KEY` / `CIRCLE_ENTITY_SECRET` (test mode)
- `DATABASE_URL`
- `ARC_RPC_URL`
- `BASE_SEPOLIA_RPC_URL` ← worker needs this or Base top-up dies

```bash
npm run dev:api
npm run dev:circle-worker   # separate terminal, same DB
```

Open tabs:

- Public Marketplace → http://localhost:3005/marketplace
- Console → demo org → **Hire desk**
- https://testnet.arcscan.app
- https://sepolia.basescan.org

**Always reuse a funded org** (fresh org = new empty treasury):

```bash
export DEMO_ORG_ID=<funded-org-id>
```

First-time funding (only if no funded org yet): run without `DEMO_ORG_ID`, fund the printed treasury addresses (Arc USDC ≥ ~8, Base USDC ≥ ~4), wait for Gateway credit, then set `DEMO_ORG_ID` from the run output. Base agents also need a little native ETH for gas (manual).

Also in `apps/api/.env` for Marketplace Lane 1 weather hire:

- `ENABLE_TESTNET_X402_FIXTURES=true`

Dry-run once. Save the printed tx hashes. Record a backup video.

---

## Console path (Marketplace) — same rails as the fleet

After a funded org exists and fleet agents are created (Act 1 or prior `demo/reset.mjs`):

1. **Marketplace** lists DataFetcher / Analyst / Writer / SeniorReviewer seeds + any **published** agents.
2. Same-org fleet hire uses **Permit2** (Lane 2) — no separate authorize step.
3. Weather fixture / other-org hire uses **x402** (Lane 1) — authorize payTo once, then pay.
4. Escrow hire (published agent with wallet) → Activity → Escrow for fund/submit/complete.
5. Publish tab → endpoint URL + ERC-8004 register → agent appears under Marketplace **Agents**.

Seller HTTP must be up for Permit2/x402 hire (`demo/run.mjs` starts them; seed URLs default to ports 4001–4004).

---

## Show (~8 min)

### Act 1 — Fleet (star)

```bash
cd AOPS-PMOA
DEMO_ORG_ID=$DEMO_ORG_ID node --env-file=apps/api/.env demo/run.mjs
```

What it does: reset → 5 agent HTTP servers → Orchestrator `/run` → payments:

1. Orchestrator → DataFetcher (Arc)
2. Orchestrator → Analyst (Arc; Analyst then pays DataFetcher — **second hop**)
3. Orchestrator → Writer (Arc)
4. Orchestrator → SeniorReviewer (**Base** — cross-chain)

Say while it runs:

1. Max loss = on-chain wallet balance (show explorer)
2. Second hop = real economy, not hub-only
3. Cross-chain = Arc agent pays Base agent; settlement on Base

Click the tx hashes from the script output.

### Act 2 — Escrow + reputation (encore)

Same funded org / agents as the fleet (edit IDs in the script if needed):

```bash
cd AOPS-PMOA/apps/api
node --env-file=.env ../../node_modules/.bin/tsx \
  ../../validation/spike-manifest-k4-completion.mts
```

Say: one hire through ERC-8183 escrow; ERC-8004 reputation only after settle.

### Act 3 — Kill switch

Pick one Arc agent from the demo org. With an operator session token:

```bash
curl -sS -X POST \
  "http://127.0.0.1:8080/v1/orgs/$DEMO_ORG_ID/agents/<agentId>/revoke" \
  -H "Authorization: Bearer <operator-session>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"demo_kill_switch"}'
```

Wait for circle-worker sweep. Show wallet drained → treasury on Arcscan.

Say: no OTP, no email — works at 3am.

---

## Do not claim

- LLM agents deciding inside Cursor/Claude
- Arc ecommerce storefront
- Gateway pays any chain at payment time (balances are per-chain)
- ValidationRegistry (not built)
- That AgentOps replaces Circle Agent Stack / Arc tutorials (we add org governance on top)

## If live fails

Play backup video → open the saved explorer tx links → still walk Acts 2–3 if API is up.

## Commands cheat-sheet

| Step | Command |
|---|---|
| Infra | `docker compose up -d postgres redis` |
| API | `npm run dev:api` |
| Worker | `npm run dev:circle-worker` |
| Fleet | `DEMO_ORG_ID=… node --env-file=apps/api/.env demo/run.mjs` |
| Escrow+rep | `tsx validation/spike-manifest-k4-completion.mts` (from `apps/api` with `--env-file=.env`) |
| Revoke | `POST /v1/orgs/:orgId/agents/:agentId/revoke` |
