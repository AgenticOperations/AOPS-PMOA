CREATE TABLE IF NOT EXISTS runtime_payment_attempts (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  connection_id text REFERENCES connections (id) ON DELETE SET NULL,
  source_id text REFERENCES payment_sources (id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  quote_hash text,
  amount_usdc numeric(20, 6) CHECK (amount_usdc > 0),
  asset text,
  rail text,
  network text,
  recipient text,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'submitting', 'settled', 'failed', 'unknown')),
  payment_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payment_metadata) = 'object'),
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(response_metadata) = 'object'),
  encrypted_result jsonb
    CHECK (encrypted_result IS NULL OR jsonb_typeof(encrypted_result) = 'object'),
  result_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  finalized_at timestamptz,
  UNIQUE (connection_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS runtime_payment_attempts_org_created_idx
  ON runtime_payment_attempts (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS runtime_payment_attempts_agent_created_idx
  ON runtime_payment_attempts (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS runtime_payment_attempts_status_created_idx
  ON runtime_payment_attempts (status, created_at ASC);

CREATE INDEX IF NOT EXISTS runtime_payment_attempts_created_idx
  ON runtime_payment_attempts (created_at ASC);
