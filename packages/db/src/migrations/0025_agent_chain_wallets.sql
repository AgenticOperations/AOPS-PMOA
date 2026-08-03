-- Per-agent wallet binding at (agent_id, mode, chain) grain.
-- circle_chain_wallets stays as the ORG TREASURY at (org_id, mode, chain);
-- this table is the agents' own wallets.

CREATE TABLE IF NOT EXISTS agent_chain_wallets (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  wallet_set_id text NOT NULL REFERENCES circle_wallet_sets (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  circle_blockchain text NOT NULL,
  circle_wallet_id text NOT NULL,
  address text NOT NULL,
  -- Hard EOA constraint. No legacy rows here, so this is safe -- unlike the
  -- older tables, which migration 0012 filled with 'sca'. Gateway rejects
  -- non-EOA signatures and Nanopayments is EOA-only, so a mistake must be
  -- rejected by the database rather than discovered at payment time.
  account_type text NOT NULL DEFAULT 'eoa' CHECK (account_type = 'eoa'),
  ref_id text NOT NULL,
  status text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning', 'active', 'swept', 'disabled')),
  provisioned_at timestamptz,
  swept_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, mode, chain)
);

CREATE INDEX IF NOT EXISTS agent_chain_wallets_org_idx
  ON agent_chain_wallets (org_id, mode, chain, status);

-- Same refId => same address across chains. Balances remain per-chain.
CREATE INDEX IF NOT EXISTS agent_chain_wallets_ref_idx
  ON agent_chain_wallets (ref_id);

-- New job types for worker-side provisioning, sweep, and top-up. This
-- CHECK has been widened five times before this migration (0011, 0013,
-- 0014, 0015, 0016) -- the full existing list must be preserved or
-- pre-existing rows violate the new constraint. Verified against the
-- latest (0016) definition rather than the original (0010) one.
ALTER TABLE circle_provider_jobs DROP CONSTRAINT IF EXISTS circle_provider_jobs_job_type_check;
ALTER TABLE circle_provider_jobs
  ADD CONSTRAINT circle_provider_jobs_job_type_check
  CHECK (
    job_type IN (
      'wallet_set.create',
      'wallet.create',
      'wallet.faucet',
      'wallet.rebalance',
      'liquidity.prepare',
      'rail.verify',
      'gateway.deposit',
      'gateway.transfer',
      'wallet.balance_sync',
      'webhook.reconcile',
      'agent_wallet.create',
      'agent_wallet.topup',
      'agent_wallet.sweep'
    )
  );
