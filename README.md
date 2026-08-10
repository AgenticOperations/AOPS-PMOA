---
created: 2026-07-06
updated: 2026-08-09
project: agentOps
ecosystem: circle
tags: [readme, product, setup, testnet, mcp, circle, arc]
---

# agentOps

[![CI](https://github.com/AgenticOperations/AOPS-PMOA/actions/workflows/ci.yml/badge.svg)](https://github.com/AgenticOperations/AOPS-PMOA/actions/workflows/ci.yml)
[![Security](https://github.com/AgenticOperations/AOPS-PMOA/actions/workflows/security.yml/badge.svg)](https://github.com/AgenticOperations/AOPS-PMOA/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

agentOps is a testnet control plane for teams operating autonomous agents. It combines agent identity, runtime credentials, policy enforcement, human approvals, operational rate limits, Circle-backed USDC wallets, hosted MCP, agent-to-agent payments, and hash-chained evidence in one organization-isolated product.

On Arc it is the **org control plane + hosted MCP** — not another wallets / x402 / Gateway SDK. Circle owns those rails; AgentOps owns policy, budgets, approvals, kill/sweep, and the audit trail. See [docs/arc-agentops-addon.md](docs/arc-agentops-addon.md).

The current release is intentionally **testnet only**. It does not represent mainnet payment execution as available.

## Where we are now

The primary development line is `main`. Live proofs (explorer links, not just unit tests) live in [docs/spike-results.md](docs/spike-results.md). The judge / demo path is [demo/DEMO-RUNBOOK.md](demo/DEMO-RUNBOOK.md).

Earlier Checkpoint 2 work (paid MCP HTTP on Circle Agent Wallets) is still documented as release evidence:

- [Paid HTTP release evidence](docs/qa/2026-07-13-x402-paid-http-evidence.md)
- [Testnet release evidence](docs/qa/2026-07-12-testnet-release-evidence.md)
- [Checkpoint 2 design](docs/superpowers/specs/2026-07-26-pmoa-checkpoint-2-submission-design.md)

## Product surface

- **Organizations and access:** Google OAuth, organization membership, roles, teams, and tenant-isolated reads and mutations.
- **Managed agents:** agent identities, runtime credentials, pause / revoke / sweep, per-agent wallets, effective policies, and activity history.
- **Policy controls:** action-specific policy drafts, validation, simulations, immutable revisions, activation, target assignment, archival, and runtime decisions.
- **Approvals:** expiring approval requests, one-time approve/deny decisions, and one-time consumption tied to the original decision.
- **Operations:** managed tool catalog, rate limits, runtime decisions, and auditable control changes.
- **Treasury:** organization treasury plus per-agent developer-controlled wallets (Arc + Base), funding, ceilings, Permit2 delegations, and kill/sweep without Circle OTP.
- **Two payment lanes:** Lane 1 — governed x402 to external merchants (`payment_x402`); Lane 2 — agent-to-agent Permit2 drawdowns (`payment_intra_fleet`). Escrow (ERC-8183) for first-hire trust, with graduation to Permit2 after settled completions.
- **Marketplace / hire:** org-governed discovery of curated fixtures and published agents; hire via micropay or escrow.
- **MCP:** hosted Streamable HTTP for remote agents plus a supported local stdio adapter, both exposing the same runtime tool contract.
- **Evidence:** classified, tenant-fenced, hash-chained audit events for operator and runtime actions.

## Architecture

```text
Browser / operator
       |
       v
Next.js web :3005  --->  Fastify API :8080  --->  PostgreSQL
                              |                  Redis (balance cache only)
                              v
                    Circle worker :8090
                    (private provider boundary)

Remote agent  --->  hosted MCP :8070  ---+
                                          +--->  Fastify runtime API
Local host    --->  standalone stdio MCP -+
Template      --->  thin runtime-client  -+

Fleet sellers (demo) :4001–4004  <---  Fleet Run / Hire / intra-fleet payments
  DataFetcher · Analyst · Writer · SeniorReviewer
```

| Workspace | Responsibility |
|---|---|
| `apps/web` | Next.js operator console and OAuth BFF |
| `apps/api` | Fastify API, identity, policy, approvals, operations, payments, evidence |
| `apps/api/src/circle-worker.ts` | Private multi-tenant Circle provider worker and liquidity-job processor |
| `apps/mcp` | Hosted Streamable HTTP MCP service and local stdio adapter |
| `packages/contracts` | Shared wire contracts |
| `packages/config` | Shared configuration helpers |
| `packages/db` | PostgreSQL migrations and migration runner |
| `packages/runtime-client` | Optional thin Node client for `/v1/runtime/...` (not a Circle SDK) |
| `packages/onchain` | Vendored ERC-8183 escrow deploy tooling |

## Requirements

- macOS or Linux with Bash
- Node.js `22.13.0` or newer and npm
- Docker Desktop with Compose v2 when using the bundled local PostgreSQL and Redis
- A Google OAuth web client configured with this callback:

  `http://localhost:3005/api/auth/google/callback`

For the Arc fleet path, configure Circle developer-controlled wallets (`CIRCLE_TREASURY_PROVIDER=developer_controlled`) plus Arc / Base RPC URLs in `apps/api/.env`. See [docs/env-inventory.md](docs/env-inventory.md) and [demo/DEMO-RUNBOOK.md](demo/DEMO-RUNBOOK.md).

## One-command setup

```bash
./setup.sh
```

The setup command:

1. Validates Node and npm.
2. Creates missing `apps/api/.env` and `apps/web/.env.local` files from their templates.
3. Asks one at a time for missing Google OAuth values. Secret input is not echoed.
4. Generates distinct base64 32-byte Circle profile and x402 result encryption keys plus a random internal worker token when absent.
5. Starts local PostgreSQL and Redis only when the configured local ports are not already reachable.
6. Installs the locked npm dependency graph, verifies the pinned Circle CLI, rejects high/critical npm advisories, and builds shared packages/migrations.
7. Starts and health-checks web `3005`, hosted MCP `8070`, API `8080`, Circle worker `8090`, and fleet sellers `4001–4004` when `DEMO_ORG_ID` has a funded fleet.
8. Keeps application services supervised until you press `Ctrl+C`.

Service logs are written to `.runtime/logs/`. PostgreSQL and Redis data use named Docker volumes and remain available after the application services stop.

Open [http://localhost:3005](http://localhost:3005), sign in with Google, and create an organization. Treasury / wallet connection depends on the configured Circle provider mode.

## Start an existing installation

```bash
./startup.sh --run-only
```

`startup.sh` is a compatibility entrypoint to the same bootstrap implementation. `--run-only` validates existing env files, dependencies, and infrastructure and starts the application services (including fleet sellers when available). It does not create env files, prompt for credentials, run `npm install`, or rebuild packages.

The equivalent npm command is:

```bash
npm run start:local
```

If any application port is already occupied, startup fails without killing the existing process.

## Environment contract

Local secrets remain gitignored. The bootstrap validates these cross-service invariants:

- API uses port `8080`; web uses `3005`; hosted MCP uses `8070`; the private Circle worker uses `8090`; fleet sellers use `4001–4004` when `DEMO_ORG_ID` is set to a funded fleet org.
- API and web use the same `APP_BASE_URL` and `SESSION_COOKIE_NAME`.
- Google OAuth redirects through the web BFF callback.
- `CIRCLE_WORKER_TOKEN` is at least 32 characters.
- `CIRCLE_PROFILE_MASTER_KEY` decodes to exactly 32 bytes.
- `X402_RESULT_ENCRYPTION_KEY` decodes to exactly 32 bytes and is distinct from the worker-only Circle profile key.
- Database and Redis URLs use supported URL schemes.

See [docs/env-inventory.md](docs/env-inventory.md) for the current key inventory. To use managed PostgreSQL or Redis, populate their URLs before running setup; the bootstrap skips local Docker startup for non-local endpoints.

## MCP server

The normal product path is the hosted Streamable HTTP endpoint:

```text
http://127.0.0.1:8070/mcp
```

Create an agent in the console, open **Credentials & wallets**, and issue a credential. The one-time reveal provides the endpoint, Claude Code configuration, Codex command, local adapter, governance instruction, and a browser verification action. Remote calls authenticate with `Authorization: Bearer <agent credential>`; plaintext credentials are never stored or shown again.

Agents call `agentops.payment_x402` for a bounded paid HTTP request (policy, approval, budget, settlement, retry) or `agentops.payment_intra_fleet` to pay another org agent via Permit2. Production paid-resource URLs require HTTPS; local QA merchant fixtures remain disabled unless `ENABLE_TESTNET_X402_FIXTURES=true` is explicitly set for an isolated test run.

Agent-facing onboarding: [docs/llms.txt](docs/llms.txt) and [docs/skill.md](docs/skill.md). The web app also serves them at [`/llms.txt`](apps/web/public/llms.txt) and [`/skill.md`](apps/web/public/skill.md); the landing page **Human / Agent** toggle switches to a structured Agent mode (`/?audience=agent`) that points agents at those files for full MCP setup.

The local stdio adapter remains supported for repository-local hosts:

```bash
cp apps/mcp/.env.example apps/mcp/.env
# Set AGENTOPS_MCP_CREDENTIAL to an agent runtime credential created in the console.
npm run dev:mcp
```

For Claude Desktop or another stdio MCP host, launch the built server with an absolute path or run the workspace development command. Never write logs to stdout from the stdio server. Hosted deployment, security, client setup, and health-check details are in [docs/deployment/hosted-mcp.md](docs/deployment/hosted-mcp.md).

## End-to-end flow (plain English + proofs)

Short version below. Full guide (Human vs Agent paths, NLP chat, Fleet Policy Pack, Circle map, bugs, explorer links): **[docs/end-to-end-system-guide.md](docs/end-to-end-system-guide.md)**. Raw hashes: [docs/spike-results.md](docs/spike-results.md). Demo script: [demo/DEMO-RUNBOOK.md](demo/DEMO-RUNBOOK.md).

### 0. Two paths: Human and Agent (Mode A)

| Path | How you enter | What you do |
|---|---|---|
| **Human** | Landing **Human** → Sign in → console / **`/chat`** | Org, fund, policy, **issue MCP URL + bearer**, approve, hire |
| **Agent** | Landing **Agent** → **`/llms.txt`** | Instructions only; Claude/Cursor uses the credential **you** pasted |
 
**You don’t host an agent.** Claude or Cursor *is* the agent session. `/llms.txt` never mints secrets. Details: [guide §7](docs/end-to-end-system-guide.md#7-two-paths-human-and-agent).

### 0b. Policies are the product (not an afterthought)

In the fleet example the org does **not** run on empty defaults. Before any hire, the operator activates a **Fleet Policy Pack** and binds it per agent — fail-closed unknown actions, Orchestrator Arc hire allowlist, Analyst second-hop-only, Base SeniorReviewer **requires human approval**, deny unknown payTo, deny external x402 unless explicitly authorized, observe outbound HTTP, optional deny-weather beat, plus per-request caps / budgets / payment access.

Stack: **policy decides → payment controls bound amount → wallet balance is hard stop → Permit2 / x402 / escrow settles.**  
See the named P1–P9 pack and step table in the [end-to-end guide §8](docs/end-to-end-system-guide.md#8-fleet-end-to-end-story-policy-composed--proven).

### 1. A real org puts real money on a ceiling

An operator signs in, funds the org treasury, and each agent gets its **own** wallet with only what it is allowed to spend. The hard limit is the on-chain balance — if the money is not there, the spend cannot happen, even if our backend misbehaves.

**Proof we tested:** funded wallet, over-cap attempt rejected (`409 insufficient_agent_wallet_balance`), under-cap settle succeeded — recorded in [spike-results acceptance artifacts](docs/spike-results.md#acceptance-artifacts). Example funded address on Arc: [0xecf29492…9b48f](https://testnet.arcscan.app/address/0xecf29492264424ae73fc1434a30a66d2f6a9b48f).

### 2. Agents hire each other under AgentOps policy (same chain)

The Orchestrator pays specialists for work. Each hop clears the Fleet Policy Pack + caps, then settles via Permit2 — not a shared spreadsheet budget. The Analyst’s second hop runs under **Analyst’s own credential and P4 (second-hop-only)**.

**Proof we tested** (Arc USDC, receipts verified from chain state — Transfer logs, not just our API):

| What happened | Amount | Explorer |
|---|---|---|
| Orchestrator → DataFetcher | 0.01 USDC | [tx](https://testnet.arcscan.app/tx/0x68c135624c3909b754a1a66246925f032906d62308c027e4611682d3ad9565ee) |
| Orchestrator → Analyst | 0.05 USDC | [tx](https://testnet.arcscan.app/tx/0x96867c7c5493d250fdc0daeff05c6d91f457fd4f75e4de26ee282dd1bce9ceb0) |
| Analyst → DataFetcher (second hop — agent is buyer *and* seller) | 0.01 USDC | [tx](https://testnet.arcscan.app/tx/0x576be257d15dfeddcab8801ef0187115076dde6e346c0388ca52adaceae6abfa) |
| Orchestrator → Writer | 0.02 USDC | [tx](https://testnet.arcscan.app/tx/0x9939df2b2c5d694802e1c53cccd5bb933cc01c01965bcb4b4f0ec548e2275822) |

### 3. Same fleet, different chain (with approval gate)

The Orchestrator pays SeniorReviewer on **Base**. In the composed example this is policy **P3**: cross-chain hire **requires human approval** (Approvals inbox → consume → re-issue), then settlement from the Orchestrator’s Base-funded wallet.

**Proof we tested:** [Base Sepolia tx 0x738e4229…716e](https://sepolia.basescan.org/tx/0x738e4229f6a35e953e647cca23ed102399abe871704461423aefa4e05594716e) (0.03 USDC).

### 4. First hire can use escrow; trust earns a faster rail

For a new counterparty, the hire can go through ERC-8183 escrow (open → fund → submit → complete). After settled completions, an operator can promote the agent to a standing Permit2 allowance so later hires are one drawdown instead of a full escrow cycle.

**Proof we tested:**

| Step | Explorer |
|---|---|
| Escrow `complete` (0.02 USDC released to provider) | [tx](https://testnet.arcscan.app/tx/0x3ca56d8657ca8e10adad9acaea773d4cddcb43004b73f2ef7f86a307dd6735fa) |
| On-chain reputation feedback (only after settled completion) | [tx](https://testnet.arcscan.app/tx/0x885467500b8e370bd9dd5dce5285ef7e311b83258329d26f5992ed35b120fe10) |
| Escrow → Permit2 graduation drawdown | [tx](https://testnet.arcscan.app/tx/0xef084b9e1dff76fafed5a28715e07f0f6bcced77349aeba964b0a93640722e04) |

### 5. Kill switch empties the wallet

Revoking an agent sweeps remaining funds back to treasury — one on-chain move, no Circle OTP loop.

**Proof we tested:** [sweep tx 0x566966b7…5627](https://testnet.arcscan.app/tx/0x566966b754ae9dca563f9f8592bfc6ba6051713c3bbcb423f272b3ec0f3d5627).

### 6. One agent through MCP (Mode A) under payment policy

Separately from the five-agent fleet, a real Claude process connected only via hosted MCP exercised allow / observe / deny / rate-limit / approval / payment-cap paths, then settled a Gateway payment and replayed the same idempotency key without double-charging.

**Proof we tested:** [policy matrix](docs/qa/2026-07-12-testnet-release-evidence.md) · [paid HTTP evidence](docs/qa/2026-07-13-x402-paid-http-evidence.md) (`payevt_2e37ca8b-…`, Gateway Base, `0.001 USDC`, replay confirmed).

### Honest limit

Lane 2 (agent-to-agent Permit2) and escrow / reputation are proven on-chain above. **Paying a real third-party x402 merchant (Lane 1 outside our fixtures) is not yet claimed** — see the open row in [spike-results acceptance artifacts](docs/spike-results.md#acceptance-artifacts).

## Development commands

```bash
npm run dev:web             # Next.js; pass -- --port 3005 when run manually
npm run dev:fleet-sellers   # Demo sellers :4001–4004 (needs DEMO_ORG_ID + funded fleet)
npm run dev:api             # Fastify API
npm run dev:circle-worker   # private Circle worker
npm run dev:mcp             # standalone stdio MCP
npm run dev:mcp:http        # hosted Streamable HTTP MCP on 8070

npm run lint
npm run typecheck
npm test
npm run build
npm run verify
```

The API and Circle worker apply pending PostgreSQL migrations at startup. Do not point `DATABASE_URL` at the legacy `BUILD` database.

The current Circle CLI/Solana dependency chain reports moderate npm advisories with no non-breaking upstream fix. Setup reports them but fails only on high or critical advisories; do not use `npm audit fix --force` without re-running the payment-provider regression suite.

## Health and operations

| Service | Health endpoint | Exposure |
|---|---|---|
| API | `http://127.0.0.1:8080/healthz` | public deployment service |
| Hosted MCP | `http://127.0.0.1:8070/healthz` | public deployment service; `/mcp` requires an agent bearer credential |
| Circle worker | `http://127.0.0.1:8090/healthz` | private network only |
| Web | `http://127.0.0.1:3005/` | public deployment service |
| Fleet sellers | `http://127.0.0.1:4001/healthz` … `:4004/healthz` | local demo paid HTTP (DataFetcher / Analyst / Writer / SeniorReviewer) |

All `/internal/circle/*` routes require the worker bearer token. The worker owns decrypted temporary Circle CLI profiles; the web and public API must never receive profile encryption keys, OTPs, or decrypted provider state.

## Current documentation

### Start here
- [docs/end-to-end-system-guide.md](docs/end-to-end-system-guide.md): **deep end-to-end guide** — Circle infra map, full flows, every proof tx link, and known bugs (including Base Sepolia external ETH indexing).
- [PRODUCT.md](PRODUCT.md): product boundaries and language.
- [DESIGN.md](DESIGN.md): authenticated-console design contract.
- [docs/arc-agentops-addon.md](docs/arc-agentops-addon.md): what AgentOps is on Arc vs Circle SDKs.
- [docs/handover.md](docs/handover.md): plain-English why (wallet ceilings, Permit2, two lanes).
- [docs/current-architecture-and-userflow.md](docs/current-architecture-and-userflow.md): as-built architecture in plain language.
- [demo/DEMO-RUNBOOK.md](demo/DEMO-RUNBOOK.md): live fleet demo script.

### Setup and deploy
- [docs/env-inventory.md](docs/env-inventory.md): current environment keys and ownership.
- [docs/ci-and-repo-standards.md](docs/ci-and-repo-standards.md): CI gates, security workflows, and GitHub community standards.
- [docs/deployment/testnet-circle-worker.md](docs/deployment/testnet-circle-worker.md): deployment and worker security model.
- [docs/deployment/hosted-mcp.md](docs/deployment/hosted-mcp.md): hosted MCP deployment, security, and client contract.

### Agents / MCP
- [docs/llms.txt](docs/llms.txt): cold-start contract for agents connecting over MCP.
- [docs/skill.md](docs/skill.md): longer agent onboarding walkthrough with examples.
- [apps/mcp/examples/README.md](apps/mcp/examples/README.md): Google ADK example client.
- [packages/runtime-client/README.md](packages/runtime-client/README.md): optional thin runtime HTTP client.
- [templates/arc-nanopayments-agentops/README.md](templates/arc-nanopayments-agentops/README.md): Mode B publish template overlay.

### Money rails and decisions
- [docs/batch-settlement-binding.md](docs/batch-settlement-binding.md): Permit2 payment rail binding.
- [docs/decisions.md](docs/decisions.md): recorded product / engineering decisions.
- [docs/decision-wallet-model.md](docs/decision-wallet-model.md): wallet model decision.
- [docs/change-manifest.md](docs/change-manifest.md): sequenced Arc change list.
- [packages/onchain/README.md](packages/onchain/README.md): vendored ERC-8183 escrow deploy notes.

### Evidence and QA
- [docs/spike-results.md](docs/spike-results.md): Arc build evidence log (tx hashes, explorer links, acceptance table).
- [docs/qa/2026-07-13-x402-paid-http-evidence.md](docs/qa/2026-07-13-x402-paid-http-evidence.md): real-agent MCP settlement, replay, credential lifecycle.
- [docs/qa/2026-07-12-testnet-release-evidence.md](docs/qa/2026-07-12-testnet-release-evidence.md): earlier accepted testnet release gates.
- [docs/features-to-discuss-later.md](docs/features-to-discuss-later.md): deliberately deferred product work.

Historical audits, build journals, critiques, screenshots, wireframes, and completed plans are retained under [archive/2026-07-12-pre-bootstrap-sanitization](archive/2026-07-12-pre-bootstrap-sanitization/README.md). They are reference material, not current implementation instructions.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branch/PR expectations, and the quality bar.
Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
Report vulnerabilities privately via [SECURITY.md](SECURITY.md).

## License

This project is licensed under the [MIT License](LICENSE).
Third-party and vendored license notes are in [NOTICE.md](NOTICE.md).
