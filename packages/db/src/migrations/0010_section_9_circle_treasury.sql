ALTER TABLE org_treasuries DROP CONSTRAINT IF EXISTS org_treasuries_chain_check;
ALTER TABLE org_treasuries
  ADD CONSTRAINT org_treasuries_chain_check
  CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche'));

ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS payment_sources_chain_check;
ALTER TABLE payment_sources
  ADD CONSTRAINT payment_sources_chain_check
  CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche'));

ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS payment_sources_rail_check;
ALTER TABLE payment_sources
  ADD CONSTRAINT payment_sources_rail_check
  CHECK (
    rail IN (
      'gateway_base',
      'gateway_arbitrum',
      'gateway_polygon',
      'gateway_optimism',
      'gateway_avalanche',
      'exact_base',
      'exact_arbitrum',
      'exact_polygon',
      'exact_optimism',
      'exact_avalanche'
    )
  );

ALTER TABLE payment_events DROP CONSTRAINT IF EXISTS payment_events_provider_mode_check;
ALTER TABLE payment_events
  ADD CONSTRAINT payment_events_provider_mode_check
  CHECK (provider_mode IN ('simulation', 'test', 'live'));

CREATE TABLE IF NOT EXISTS org_payment_modes (
  org_id text PRIMARY KEY REFERENCES orgs (id) ON DELETE RESTRICT,
  mode text NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS circle_chain_capabilities (
  id text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche')),
  circle_blockchain text NOT NULL,
  gateway_domain integer NOT NULL,
  wallet_account_type text NOT NULL DEFAULT 'eoa' CHECK (wallet_account_type IN ('eoa')),
  gateway_supported boolean NOT NULL DEFAULT true,
  nanopayments_supported boolean NOT NULL DEFAULT true,
  wallet_supported boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mode, chain)
);

INSERT INTO circle_chain_capabilities (
  id, mode, chain, circle_blockchain, gateway_domain, metadata
)
VALUES
  ('cap_test_base', 'test', 'base', 'BASE-SEPOLIA', 6, '{"network":"Base Sepolia"}'),
  ('cap_test_arbitrum', 'test', 'arbitrum', 'ARB-SEPOLIA', 3, '{"network":"Arbitrum Sepolia"}'),
  ('cap_test_polygon', 'test', 'polygon', 'MATIC-AMOY', 7, '{"network":"Polygon Amoy"}'),
  ('cap_test_optimism', 'test', 'optimism', 'OP-SEPOLIA', 2, '{"network":"OP Sepolia"}'),
  ('cap_test_avalanche', 'test', 'avalanche', 'AVAX-FUJI', 1, '{"network":"Avalanche Fuji"}'),
  ('cap_live_base', 'live', 'base', 'BASE', 6, '{"network":"Base"}'),
  ('cap_live_arbitrum', 'live', 'arbitrum', 'ARB', 3, '{"network":"Arbitrum"}'),
  ('cap_live_polygon', 'live', 'polygon', 'MATIC', 7, '{"network":"Polygon PoS"}'),
  ('cap_live_optimism', 'live', 'optimism', 'OP', 2, '{"network":"Optimism"}'),
  ('cap_live_avalanche', 'live', 'avalanche', 'AVAX', 1, '{"network":"Avalanche"}')
ON CONFLICT (mode, chain) DO NOTHING;

CREATE TABLE IF NOT EXISTS circle_wallet_sets (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  provider text NOT NULL DEFAULT 'circle_wallets' CHECK (provider = 'circle_wallets'),
  circle_wallet_set_id text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  account_type text NOT NULL DEFAULT 'eoa' CHECK (account_type = 'eoa'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, mode)
);

CREATE TABLE IF NOT EXISTS circle_chain_wallets (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  wallet_set_id text NOT NULL REFERENCES circle_wallet_sets (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche')),
  circle_blockchain text NOT NULL,
  circle_wallet_id text NOT NULL,
  account_type text NOT NULL DEFAULT 'eoa' CHECK (account_type = 'eoa'),
  address text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, mode, chain)
);

CREATE INDEX IF NOT EXISTS circle_chain_wallets_org_mode_idx
  ON circle_chain_wallets (org_id, mode, chain);

CREATE TABLE IF NOT EXISTS circle_provider_jobs (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  job_type text NOT NULL CHECK (job_type IN ('wallet_set.create', 'wallet.create', 'gateway.deposit', 'gateway.transfer', 'wallet.balance_sync', 'webhook.reconcile')),
  chain text CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche')),
  status text NOT NULL CHECK (status IN ('queued', 'submitted', 'complete', 'failed', 'blocked')),
  amount_usdc numeric(20, 6) CHECK (amount_usdc IS NULL OR amount_usdc >= 0),
  provider_ref text,
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS circle_provider_jobs_org_mode_idx
  ON circle_provider_jobs (org_id, mode, created_at DESC);
