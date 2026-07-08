ALTER TABLE activity_items DROP CONSTRAINT activity_items_category_check;
ALTER TABLE activity_items
  ADD CONSTRAINT activity_items_category_check
  CHECK (category IN ('policy', 'approval', 'runtime', 'integration', 'operation'));

CREATE TABLE tool_catalog (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  name text NOT NULL,
  display_name text NOT NULL,
  category text NOT NULL DEFAULT 'tool',
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  description text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'runtime', 'import')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX tool_catalog_org_status_idx
  ON tool_catalog (org_id, status, name ASC);

CREATE TABLE operational_rate_limits (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  target_type text NOT NULL CHECK (target_type IN ('org', 'team', 'agent', 'connection')),
  target_id text NOT NULL,
  action_id text NOT NULL REFERENCES policy_action_registry (action_id) ON DELETE RESTRICT,
  bucket text NOT NULL DEFAULT 'default',
  limit_count integer NOT NULL CHECK (limit_count > 0),
  window_seconds integer NOT NULL CHECK (window_seconds BETWEEN 1 AND 86400),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX operational_rate_limits_org_target_idx
  ON operational_rate_limits (org_id, target_type, target_id, action_id, status);

CREATE TABLE operational_rate_counters (
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  rate_limit_id text NOT NULL REFERENCES operational_rate_limits (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  connection_id text REFERENCES connections (id) ON DELETE RESTRICT,
  action_id text NOT NULL REFERENCES policy_action_registry (action_id) ON DELETE RESTRICT,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_limit_id, agent_id, connection_id, bucket, window_start)
);

CREATE TABLE operational_decisions (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  connection_id text REFERENCES connections (id) ON DELETE SET NULL,
  policy_decision_id text REFERENCES policy_decisions (id) ON DELETE SET NULL,
  approval_id text REFERENCES approval_requests (id) ON DELETE SET NULL,
  action_id text NOT NULL REFERENCES policy_action_registry (action_id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('allow', 'deny', 'approval_required', 'observe', 'rate_limited')),
  reason_code text NOT NULL,
  explanation text NOT NULL,
  tool_name text,
  tool_risk_level text,
  resource_label text,
  resource_domain text,
  resource_category text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  audit_event_id text REFERENCES audit_events (id) ON DELETE SET NULL,
  activity_id text REFERENCES activity_items (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX operational_decisions_org_created_idx
  ON operational_decisions (org_id, created_at DESC);

CREATE INDEX operational_decisions_agent_created_idx
  ON operational_decisions (org_id, agent_id, created_at DESC);

CREATE INDEX operational_decisions_blocked_idx
  ON operational_decisions (org_id, decision, created_at DESC)
  WHERE decision IN ('deny', 'rate_limited');
