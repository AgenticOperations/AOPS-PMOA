CREATE TABLE policy_action_registry (
  action_id text PRIMARY KEY,
  category text NOT NULL,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  enforceability text NOT NULL CHECK (enforceability IN ('enforceable')),
  introduced_section integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_drafts (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('preset', 'blank', 'request', 'structured')),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL CHECK (category IN ('management', 'operational', 'capability')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'activated', 'discarded')),
  statements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(statements) = 'array'),
  validation jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation) = 'object'),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  activated_policy_id text,
  activated_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX policy_drafts_org_status_idx
  ON policy_drafts (org_id, status, updated_at DESC);

CREATE TABLE policy_versions (
  policy_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  draft_id text REFERENCES policy_drafts (id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL CHECK (category IN ('management', 'operational', 'capability')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  statements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(statements) = 'array'),
  validation jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation) = 'object'),
  change_reason text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  archived_by text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, version)
);

CREATE INDEX policy_versions_org_status_idx
  ON policy_versions (org_id, status, created_at DESC);

CREATE TABLE policy_bindings (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('org', 'team', 'agent', 'connection')),
  target_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_by text NOT NULL,
  removed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  FOREIGN KEY (policy_id, policy_version) REFERENCES policy_versions (policy_id, version) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX policy_bindings_active_unique_idx
  ON policy_bindings (org_id, policy_id, policy_version, target_type, target_id)
  WHERE status = 'active';

CREATE INDEX policy_bindings_org_target_idx
  ON policy_bindings (org_id, target_type, target_id, status);

CREATE TABLE policy_decisions (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  actor_type text NOT NULL,
  actor_id text,
  actor_role text,
  action_id text NOT NULL REFERENCES policy_action_registry (action_id) ON DELETE RESTRICT,
  target_type text NOT NULL,
  target_id text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  decision text NOT NULL CHECK (decision IN ('allow', 'deny', 'approval_required', 'observe')),
  enforceability text NOT NULL CHECK (enforceability IN ('enforceable')),
  reason_code text NOT NULL,
  explanation text NOT NULL,
  matched jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(matched) = 'array'),
  audit_event_id text REFERENCES audit_events (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX policy_decisions_org_action_idx
  ON policy_decisions (org_id, action_id, created_at DESC);

CREATE INDEX policy_decisions_org_target_idx
  ON policy_decisions (org_id, target_type, target_id, created_at DESC);

CREATE TABLE policy_simulations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  draft_id text REFERENCES policy_drafts (id) ON DELETE RESTRICT,
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX policy_simulations_org_created_idx
  ON policy_simulations (org_id, created_at DESC);

INSERT INTO policy_action_registry (
  action_id,
  category,
  label,
  description,
  enforceability,
  introduced_section
)
VALUES
  ('management.agent.activate', 'management', 'Activate agent', 'Allow or block activating an agent identity.', 'enforceable', 2),
  ('management.agent.create', 'management', 'Create agent', 'Allow or block registering a new agent identity.', 'enforceable', 2),
  ('management.agent.deactivate', 'management', 'Deactivate agent', 'Allow or block deactivating an agent identity.', 'enforceable', 2),
  ('management.agent.pause', 'management', 'Pause agent', 'Allow or block pausing an agent identity.', 'enforceable', 2),
  ('management.connection.issue', 'management', 'Issue credential', 'Allow or block issuing a runtime credential for an agent.', 'enforceable', 2),
  ('management.connection.revoke', 'management', 'Revoke credential', 'Allow or block revoking a runtime credential.', 'enforceable', 2),
  ('management.connection.rotate', 'management', 'Rotate credential', 'Allow or block rotating a runtime credential.', 'enforceable', 2),
  ('management.policy.activate', 'management', 'Activate policy', 'Allow or block activating a policy draft.', 'enforceable', 2),
  ('management.policy.archive', 'management', 'Archive policy', 'Allow or block archiving an active policy version.', 'enforceable', 2),
  ('management.policy.bind', 'management', 'Bind policy', 'Allow or block attaching a policy to an org, team, agent, or credential.', 'enforceable', 2),
  ('management.policy.create', 'management', 'Create policy', 'Allow or block creating a policy draft.', 'enforceable', 2)
ON CONFLICT (action_id) DO NOTHING;
