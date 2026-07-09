ALTER TABLE activity_items DROP CONSTRAINT activity_items_category_check;
ALTER TABLE activity_items
  ADD CONSTRAINT activity_items_category_check
  CHECK (category IN ('policy', 'approval', 'runtime', 'integration', 'operation', 'payment', 'treasury'));

CREATE TABLE org_treasuries (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  treasury_type text NOT NULL CHECK (treasury_type IN ('gateway')),
  provider text NOT NULL DEFAULT 'circle_gateway' CHECK (provider IN ('circle_gateway', 'simulation')),
  chain text NOT NULL CHECK (chain IN ('base')),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX org_treasuries_org_status_idx
  ON org_treasuries (org_id, status, created_at DESC);

CREATE TABLE payment_sources (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  treasury_id text REFERENCES org_treasuries (id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('gateway', 'direct_exact', 'dedicated_wallet')),
  provider text NOT NULL CHECK (provider IN ('circle_gateway', 'circle_wallets', 'manual', 'simulation')),
  rail text NOT NULL CHECK (rail IN ('gateway_base', 'exact_base')),
  chain text NOT NULL CHECK (chain IN ('base')),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  account_type text NOT NULL DEFAULT 'unknown' CHECK (account_type IN ('eoa', 'sca', 'virtual', 'unknown')),
  address text,
  external_wallet_id text,
  simulated_balance_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (simulated_balance_usdc >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_sources_org_rail_status_idx
  ON payment_sources (org_id, rail, chain, status, created_at DESC);

CREATE TABLE agent_payment_accounts (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'disabled' CHECK (status IN ('active', 'disabled')),
  payment_access boolean NOT NULL DEFAULT false,
  budget_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (budget_usdc >= 0),
  spent_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (spent_usdc >= 0),
  reserved_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (reserved_usdc >= 0),
  per_request_cap_usdc numeric(20, 6) NOT NULL DEFAULT 0 CHECK (per_request_cap_usdc >= 0),
  approval_threshold_usdc numeric(20, 6),
  dedicated_wallet_required boolean NOT NULL DEFAULT false,
  allowed_rails text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, agent_id)
);

CREATE INDEX agent_payment_accounts_org_status_idx
  ON agent_payment_accounts (org_id, status, payment_access);

CREATE TABLE payment_route_observations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  connection_id text REFERENCES connections (id) ON DELETE SET NULL,
  requested_network text,
  requested_asset text,
  requested_rail text,
  supported_rail text,
  amount_usdc numeric(20, 6),
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  reason_code text NOT NULL,
  resource_url text,
  resource_category text,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_route_observations_org_agent_idx
  ON payment_route_observations (org_id, agent_id, observed_at DESC);

CREATE TABLE payment_reservations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  connection_id text REFERENCES connections (id) ON DELETE SET NULL,
  source_id text NOT NULL REFERENCES payment_sources (id) ON DELETE RESTRICT,
  amount_usdc numeric(20, 6) NOT NULL CHECK (amount_usdc > 0),
  asset text NOT NULL DEFAULT 'USDC',
  rail text NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved', 'settled', 'released', 'failed')),
  reason_code text NOT NULL,
  quote_hash text NOT NULL,
  quote jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(quote) = 'object'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_reservations_org_agent_idx
  ON payment_reservations (org_id, agent_id, created_at DESC);

CREATE TABLE payment_events (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  connection_id text REFERENCES connections (id) ON DELETE SET NULL,
  source_id text REFERENCES payment_sources (id) ON DELETE SET NULL,
  reservation_id text REFERENCES payment_reservations (id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('submitted', 'settled', 'failed', 'simulated')),
  provider_mode text NOT NULL CHECK (provider_mode IN ('simulation', 'live')),
  rail text NOT NULL,
  chain text NOT NULL,
  amount_usdc numeric(20, 6) NOT NULL CHECK (amount_usdc > 0),
  asset text NOT NULL DEFAULT 'USDC',
  recipient text NOT NULL,
  network text NOT NULL,
  resource_url text,
  resource_category text,
  quote jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(quote) = 'object'),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  activity_id text REFERENCES activity_items (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_events_org_agent_created_idx
  ON payment_events (org_id, agent_id, created_at DESC);
