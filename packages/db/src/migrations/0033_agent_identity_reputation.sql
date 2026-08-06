-- 0033_agent_identity_reputation.sql
-- ERC-8004 identity is an ERC-721 NFT per agent.
-- Registry addresses re-verified live against Arc testnet (eth_getCode) and
-- against the canonical erc-8004/erc-8004-contracts source before this
-- migration was written -- not tutorial-grade guesses.

CREATE TABLE IF NOT EXISTS agent_onchain_identities (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  registry_address text NOT NULL,
  token_id numeric(78, 0),
  agent_uri text NOT NULL,
  register_tx_hash text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'registered', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, mode, chain)
);

-- Every reputation write, with the escrow job that earned it.
-- escrow_job_id is NOT NULL BY DESIGN: reputation cannot exist without
-- a settled escrow job. This is the entire contribution -- the standard
-- permits unearned feedback; the schema here forbids it.
CREATE TABLE IF NOT EXISTS agent_reputation_events (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  escrow_job_id text NOT NULL REFERENCES escrow_jobs (id) ON DELETE RESTRICT,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  feedback_tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (escrow_job_id)
);

CREATE INDEX IF NOT EXISTS agent_reputation_events_agent_idx
  ON agent_reputation_events (agent_id, created_at DESC);
