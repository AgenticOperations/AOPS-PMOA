# AgentOps overlay — arc-nanopayments

This is the **Mode B** path: Circle’s official [arc-nanopayments](https://github.com/circlefin/arc-nanopayments) sample, with AgentOps as the **add-on** for the buyer (no local spend key) and Publish for the seller.

AgentOps does **not** replace `@circle-fin/x402-batching`, Gateway, or seller `withGateway()`. Those stay Circle’s.

## What changes vs upstream

| Role | Upstream Arc | With AgentOps |
|---|---|---|
| **Buyer agent** | `BUYER_PRIVATE_KEY` + EIP-3009 via x402-batching | AgentOps credential → `@agentops-pmoa/runtime-client` → `paymentX402` (policy + treasury) |
| **Seller app** | Next.js x402 endpoints | Unchanged Circle stack; after host, paste URL on AgentOps **Publish** and register ERC-8004 |
| **Wallets** | `generate-wallets` local keys | Buyer spends via AgentOps-provisioned DCW; seller can keep the sample wallet |

## Quick start

### 1. Clone upstream seller (Circle rails)

```bash
git clone https://github.com/circlefin/arc-nanopayments.git
cd arc-nanopayments
# Follow upstream README: Supabase, generate-wallets, npm run dev
```

Deploy or tunnel a public HTTPS origin for the seller.

### 2. Create agent + credential in AgentOps

In the console: **Agents → Create → Publish Arc agent** → issue a credential on the Credentials tab.

### 3. Publish the seller URL

On the agent **Publish** tab: paste the public seller origin → **Register identity on Arc**.

### 4. Run the AgentOps buyer (this overlay)

From the AOPS-PMOA monorepo (after `npm install` at the root):

```bash
cd AOPS-PMOA
npm run build --workspace @agentops-pmoa/runtime-client

export AGENTOPS_API_BASE_URL=http://127.0.0.1:8080
export AGENTOPS_AGENT_CREDENTIAL=agt_cred_...   # from console
export SELLER_BASE_URL=https://your-nanopayments.example.com
export SELLER_PATH=/api/protected              # adjust to upstream route

node --import tsx templates/arc-nanopayments-agentops/buyer.mts
```

The buyer calls AgentOps runtime `paymentX402` against the seller URL — **no `BUYER_PRIVATE_KEY`**.

### 5. Hire (discrete jobs)

For ERC-8183 jobs (not micropayments), use Console → Empower → **Hire published agent**, or Arc’s [8183 tutorial](https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job) mental model executed through AgentOps escrow.

Do **not** use [arc-escrow](https://github.com/circlefin/arc-escrow) (Refund Protocol ≠ ERC-8183).

## Env reference

| Variable | Required | Meaning |
|---|---|---|
| `AGENTOPS_API_BASE_URL` | yes | AgentOps API origin |
| `AGENTOPS_AGENT_CREDENTIAL` | yes | Agent connection secret |
| `SELLER_BASE_URL` | yes | Public nanopayments seller origin |
| `SELLER_PATH` | no | Path to pay (default `/api/protected`) |
| `SELLER_METHOD` | no | HTTP method (default `GET`) |

## See also

- [docs/arc-agentops-addon.md](../../docs/arc-agentops-addon.md) — positioning + Arc surface map  
- [demo/DEMO-RUNBOOK.md](../../demo/DEMO-RUNBOOK.md) — fleet demo (not this template)
