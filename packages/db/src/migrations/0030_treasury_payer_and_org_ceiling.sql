-- 0030_treasury_payer_and_org_ceiling.sql
-- Treasury-funded delegations plus the org-wide ceiling that bounds them.
--
-- payer_kind exists because payer_agent_id IS NULL was doing double duty:
-- it marked a user-owned wallet, and a treasury payer would look identical.
-- agent-funding.ts selects on exactly that predicate, so without a real
-- discriminator just-in-time funding would draw against the wrong payer.

ALTER TABLE agent_delegations
  ADD COLUMN payer_kind text NOT NULL DEFAULT 'user'
    CHECK (payer_kind IN ('user', 'agent', 'treasury'));

-- Existing rows: a non-null payer_agent_id always meant an agent wallet the
-- platform controls. Everything else was the operator's own wallet.
UPDATE agent_delegations SET payer_kind = 'agent' WHERE payer_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_delegations_payer_kind_idx
  ON agent_delegations (org_id, payer_kind, mode, chain, status);

-- The org-wide ceiling. Per chain, NOT global: a Permit2 allowance lives on
-- one chain, so a single cross-chain number could never be enforced on-chain
-- and would be a comforting lie.
CREATE TABLE IF NOT EXISTS org_delegation_ceilings (
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL
    CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  ceiling_usdc numeric(20, 6) NOT NULL CHECK (ceiling_usdc >= 0),
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, mode, chain)
);
