CREATE TABLE orgs (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_event_heads (
  org_id text PRIMARY KEY REFERENCES orgs (id) ON DELETE RESTRICT,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_event_hash text CHECK (last_event_hash IS NULL OR length(last_event_hash) = 64),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  sequence bigint NOT NULL CHECK (sequence > 0),
  idempotency_key text,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (
    actor_type IN ('user', 'agent', 'connection', 'system', 'service', 'key', 'unknown')
  ),
  actor_id text,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'error', 'pending')),
  reason_code text,
  resource_type text,
  resource_id text,
  request_id text,
  source_section text,
  source_system text,
  source_ref text,
  policy_ref text,
  decision_ref text,
  approval_ref text,
  external_refs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(external_refs) = 'object'),
  retention_class text NOT NULL DEFAULT 'standard' CHECK (
    retention_class IN ('standard', 'payment', 'security', 'legal_hold')
  ),
  redaction_state text NOT NULL CHECK (redaction_state IN ('none', 'redacted')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_body jsonb NOT NULL,
  canonical_body_hash text NOT NULL CHECK (length(canonical_body_hash) = 64),
  previous_hash text CHECK (previous_hash IS NULL OR length(previous_hash) = 64),
  event_hash text NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, sequence)
);

CREATE UNIQUE INDEX audit_events_org_idempotency_key_idx
  ON audit_events (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX audit_events_org_recorded_idx
  ON audit_events (org_id, recorded_at DESC, id DESC);

CREATE INDEX audit_events_org_type_idx
  ON audit_events (org_id, event_type);

CREATE INDEX audit_events_org_resource_idx
  ON audit_events (org_id, resource_type, resource_id)
  WHERE resource_type IS NOT NULL AND resource_id IS NOT NULL;

CREATE INDEX audit_events_org_request_idx
  ON audit_events (org_id, request_id)
  WHERE request_id IS NOT NULL;
