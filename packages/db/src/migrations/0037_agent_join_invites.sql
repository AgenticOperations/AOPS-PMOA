CREATE TABLE IF NOT EXISTS agent_join_invites (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  created_by_member_id text,
  token_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT '',
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1 AND max_uses <= 10000),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (use_count <= max_uses)
);

CREATE INDEX IF NOT EXISTS agent_join_invites_org_idx
  ON agent_join_invites (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_open_join_events (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  client_fingerprint text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_open_join_events_org_created_idx
  ON agent_open_join_events (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_open_join_events_fingerprint_idx
  ON agent_open_join_events (client_fingerprint, created_at DESC);
