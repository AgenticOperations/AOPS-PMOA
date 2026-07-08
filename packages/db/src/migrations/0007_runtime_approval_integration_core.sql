CREATE TABLE approval_requests (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL,
  connection_id text NOT NULL,
  decision_id text NOT NULL REFERENCES policy_decisions (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled', 'consumed')),
  action_id text NOT NULL REFERENCES policy_action_registry (action_id) ON DELETE RESTRICT,
  target_type text NOT NULL,
  target_id text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  context_hash text NOT NULL,
  requested_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  denied_by text,
  denied_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE RESTRICT,
  FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE RESTRICT
);

CREATE INDEX approval_requests_org_status_idx
  ON approval_requests (org_id, status, created_at DESC);

CREATE INDEX approval_requests_agent_status_idx
  ON approval_requests (org_id, agent_id, status, created_at DESC);

CREATE TABLE approval_actions (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  approval_id text NOT NULL REFERENCES approval_requests (id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent', 'connection', 'system')),
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('requested', 'approved', 'denied', 'cancelled', 'expired', 'consumed')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX approval_actions_approval_idx
  ON approval_actions (approval_id, created_at ASC);

CREATE TABLE approval_consumptions (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  approval_id text NOT NULL REFERENCES approval_requests (id) ON DELETE RESTRICT,
  decision_id text NOT NULL REFERENCES policy_decisions (id) ON DELETE RESTRICT,
  connection_id text NOT NULL,
  context_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX approval_consumptions_once_idx
  ON approval_consumptions (approval_id);

CREATE TABLE activity_items (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text,
  connection_id text,
  decision_id text REFERENCES policy_decisions (id) ON DELETE SET NULL,
  approval_id text REFERENCES approval_requests (id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('policy', 'approval', 'runtime', 'integration')),
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'pending', 'error')),
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE SET NULL,
  FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE SET NULL
);

CREATE INDEX activity_items_org_created_idx
  ON activity_items (org_id, created_at DESC);

CREATE INDEX activity_items_agent_created_idx
  ON activity_items (org_id, agent_id, created_at DESC);

CREATE TABLE mcp_sessions (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL,
  connection_id text NOT NULL,
  protocol text NOT NULL DEFAULT 'jsonrpc-http',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE RESTRICT,
  FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE RESTRICT
);

CREATE INDEX mcp_sessions_connection_idx
  ON mcp_sessions (org_id, connection_id, last_seen_at DESC);

CREATE TABLE connection_rate_limits (
  connection_id text NOT NULL,
  org_id text NOT NULL,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, bucket, window_start),
  FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE CASCADE
);

INSERT INTO policy_action_registry (
  action_id,
  category,
  label,
  description,
  enforceability,
  introduced_section
)
VALUES
  ('payment.x402.authorize', 'runtime', 'Authorize x402 payment', 'Check whether an agent may authorize an x402 payment. Money movement is implemented later.', 'enforceable', 4),
  ('runtime.http.request', 'runtime', 'External HTTP request', 'Check whether an agent may access an external HTTP/API resource.', 'enforceable', 4),
  ('tool.call', 'runtime', 'Tool call', 'Check whether an agent may call a tool exposed through an agentOps-controlled surface.', 'enforceable', 4)
ON CONFLICT (action_id) DO NOTHING;
