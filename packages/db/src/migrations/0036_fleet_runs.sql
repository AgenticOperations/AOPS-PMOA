-- 0036_fleet_runs.sql
-- Fleet Run chat: org-scoped goal runs with event log + checklist JSON.

CREATE TABLE IF NOT EXISTS fleet_runs (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  goal text NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'running', 'completed', 'failed', 'cancelled')),
  orchestrator_agent_id text REFERENCES agents (id) ON DELETE SET NULL,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  agents jsonb NOT NULL DEFAULT '{}'::jsonb,
  fruit jsonb,
  error text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS fleet_runs_org_created_idx
  ON fleet_runs (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fleet_run_events (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES fleet_runs (id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  seq integer NOT NULL,
  kind text NOT NULL,
  tool text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS fleet_run_events_run_seq_idx
  ON fleet_run_events (run_id, seq);
