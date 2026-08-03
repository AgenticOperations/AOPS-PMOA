-- 0027_payto_allowlist.sql
-- Verified payment destinations. In x402 the SERVER's 402 response supplies
-- payTo; a spoofed or compromised provider can name its own address. After
-- signing, amount and destination are cryptographically immutable, so the
-- theft is irreversible. Validate before signing.

CREATE TABLE IF NOT EXISTS payment_destination_allowlist (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  chain text NOT NULL CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  address text NOT NULL,
  label text NOT NULL,
  source text NOT NULL CHECK (source IN ('marketplace', 'tenant_configured', 'agent_wallet')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by text NOT NULL,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, chain, address)
);

CREATE INDEX IF NOT EXISTS payment_destination_allowlist_lookup_idx
  ON payment_destination_allowlist (org_id, chain, address, status);
