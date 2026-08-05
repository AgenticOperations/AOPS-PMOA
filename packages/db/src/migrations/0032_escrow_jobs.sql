-- 0032_escrow_jobs.sql
-- ERC-8183 escrow lifecycle. Mirrors on-chain state so the control plane
-- can reason without an RPC per decision. The CHAIN is authoritative --
-- on disagreement, trust the chain and reconcile.

CREATE TABLE IF NOT EXISTS escrow_jobs (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  client_agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  provider_address text NOT NULL,
  evaluator_address text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  escrow_address text NOT NULL,
  token_address text NOT NULL,
  -- Assigned by the chain, read from the JobCreated event. NULL until the
  -- createJob receipt is parsed.
  onchain_job_id numeric(78, 0),
  budget_usdc numeric(20, 6) NOT NULL CHECK (budget_usdc > 0),
  reservation_id text REFERENCES payment_reservations (id) ON DELETE RESTRICT,
  -- Mirrors the ERC-8183 lifecycle exactly. 'expired' is a DISTINCT row
  -- from 'rejected' even though the contract refunds both identically --
  -- we need to tell "delivered but unevaluated" apart from "failed" in our
  -- own evidence, even though the chain cannot.
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'funded', 'submitted', 'completed', 'rejected', 'expired')),
  -- Mode 2 means evaluator == client. Recorded explicitly so claim
  -- discipline can be enforced from data rather than memory.
  escrow_mode integer NOT NULL CHECK (escrow_mode IN (2, 3)),
  deliverable_hash text,
  expires_at timestamptz NOT NULL,
  create_tx_hash text,
  fund_tx_hash text,
  submit_tx_hash text,
  terminal_tx_hash text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One row per on-chain job per chain. Guards against double-recording a
  -- job if a create is retried after the receipt was already parsed.
  UNIQUE (chain, escrow_address, onchain_job_id)
);

CREATE INDEX IF NOT EXISTS escrow_jobs_org_state_idx
  ON escrow_jobs (org_id, mode, state, expires_at);

-- Evaluator-liveness watch: Submitted jobs approaching expiry are the trap
-- case -- the provider delivered and will be refunded against.
CREATE INDEX IF NOT EXISTS escrow_jobs_liveness_idx
  ON escrow_jobs (state, expires_at) WHERE state = 'submitted';

CREATE INDEX IF NOT EXISTS escrow_jobs_provider_idx
  ON escrow_jobs (org_id, provider_address, state);
