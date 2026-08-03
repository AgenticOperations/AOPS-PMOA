-- M1: org-level policy default. Defaults to 'deny' (fail closed).
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS default_policy_effect text NOT NULL DEFAULT 'deny'
    CHECK (default_policy_effect IN ('deny', 'allow'));

-- M2: emergency stop. Agents already have 'paused'/'suspended' in
-- agents.status (migration 0002); orgs have no equivalent.
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS frozen boolean NOT NULL DEFAULT false;
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS frozen_reason text;
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz;
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS frozen_by text;
