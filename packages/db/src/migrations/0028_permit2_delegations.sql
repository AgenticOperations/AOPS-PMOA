-- 0028_permit2_delegations.sql
-- Permit2 ceiling + drawdown accounting. The on-chain allowance is the
-- authority; these rows mirror it so the control plane can reason about
-- remaining headroom without an RPC call per decision.

CREATE TABLE IF NOT EXISTS agent_delegations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  payer_agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  payee_agent_id text REFERENCES agents (id) ON DELETE RESTRICT,
  payee_address text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  token_address text NOT NULL,
  ceiling_usdc numeric(20, 6) NOT NULL CHECK (ceiling_usdc > 0),
  drawn_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (drawn_usdc >= 0),
  expires_at timestamptz NOT NULL,
  permit_nonce bigint NOT NULL,
  signature text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'exhausted', 'expired', 'revoked')),
  approved_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (drawn_usdc <= ceiling_usdc),
  UNIQUE (payer_agent_id, payee_address, mode, chain, permit_nonce)
);

CREATE INDEX IF NOT EXISTS agent_delegations_active_idx
  ON agent_delegations (org_id, payer_agent_id, mode, chain, status);

-- Every drawdown, append-only. The on-chain allowance decrements; this is
-- the local record of why.
CREATE TABLE IF NOT EXISTS agent_delegation_drawdowns (
  id text PRIMARY KEY,
  delegation_id text NOT NULL REFERENCES agent_delegations (id) ON DELETE RESTRICT,
  amount_usdc numeric(20, 6) NOT NULL CHECK (amount_usdc > 0),
  tx_hash text,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'confirmed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
