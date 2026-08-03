-- 0026_agent_allocations.sql
-- Per-agent-per-chain allocation. K-14: each chain needs its own
-- low-water mark and gas reserve, because balances are per-chain state.
--
-- This does NOT track real treasury deposits -- there is no local ledger
-- of deposited amounts anywhere in this schema. The solvency invariant
-- (sum(allocated) <= real treasury deposits) reads deposits live from
-- Circle's Gateway API (getGatewayBalance), the same way Phase 3's
-- balance ceiling reads an agent wallet's native balance live rather
-- than trusting a local counter.

CREATE TABLE IF NOT EXISTS agent_allocations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  allocated_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (allocated_usdc >= 0),
  gas_reserve_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (gas_reserve_usdc >= 0),
  low_water_mark_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (low_water_mark_usdc >= 0),
  ceiling_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (ceiling_usdc >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, mode, chain),
  CHECK (ceiling_usdc >= allocated_usdc),
  CHECK (allocated_usdc >= low_water_mark_usdc)
);

CREATE INDEX IF NOT EXISTS agent_allocations_org_idx
  ON agent_allocations (org_id, mode, chain, status);
