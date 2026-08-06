-- 0034_ledger_postings.sql
-- Append-only postings. Every economic event is a row; balances are
-- DERIVED by summation. Corrections happen by appending an offsetting
-- row, NEVER by editing. The existing counters on agent_payment_accounts
-- stay as a cache -- this is the manifest's "minimum viable version",
-- not full double-entry. Say so honestly.

CREATE TABLE IF NOT EXISTS ledger_postings (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text REFERENCES agents (id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  chain text CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc')),
  -- What happened. Signed amounts: reserve is negative available,
  -- release is positive, settle moves reserved to spent.
  entry_type text NOT NULL CHECK (entry_type IN (
    'reserve', 'release', 'settle', 'topup', 'sweep', 'deposit', 'correction'
  )),
  amount_usdc numeric(20, 6) NOT NULL,
  -- What caused it. At least one must be present.
  reservation_id text REFERENCES payment_reservations (id) ON DELETE RESTRICT,
  attempt_id text,
  job_id text,
  -- Corrections reference the posting they offset. Never edit a posting.
  corrects_posting_id text REFERENCES ledger_postings (id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    reservation_id IS NOT NULL OR attempt_id IS NOT NULL
    OR job_id IS NOT NULL OR corrects_posting_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS ledger_postings_agent_idx
  ON ledger_postings (org_id, agent_id, mode, chain, created_at);
CREATE INDEX IF NOT EXISTS ledger_postings_reservation_idx
  ON ledger_postings (reservation_id);

-- No UPDATE, no DELETE. Enforce it rather than trusting convention.
CREATE OR REPLACE FUNCTION ledger_postings_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_postings is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_postings_no_update
  BEFORE UPDATE OR DELETE ON ledger_postings
  FOR EACH ROW EXECUTE FUNCTION ledger_postings_immutable();
