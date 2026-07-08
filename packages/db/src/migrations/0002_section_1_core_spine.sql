ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS default_team_id text,
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS orgs_slug_unique_idx
  ON orgs (slug)
  WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'auditor', 'viewer', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'removed')),
  invited_by_member_id text,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS memberships_org_idx ON memberships (org_id);

CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_one_default_per_org_idx
  ON teams (org_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS teams_org_idx ON teams (org_id, archived_at);

INSERT INTO teams (id, org_id, name, description, is_default)
SELECT
  'team_default_' || regexp_replace(o.id, '[^a-zA-Z0-9_]+', '_', 'g'),
  o.id,
  'Default',
  '',
  true
FROM orgs o
WHERE NOT EXISTS (
  SELECT 1 FROM teams t WHERE t.org_id = o.id
);

UPDATE teams
   SET is_default = true,
       updated_at = now()
 WHERE id IN (
   SELECT DISTINCT ON (org_id) id
     FROM teams
    WHERE archived_at IS NULL
    ORDER BY org_id, created_at ASC, id ASC
 )
   AND NOT EXISTS (
     SELECT 1
       FROM teams current_default
      WHERE current_default.org_id = teams.org_id
        AND current_default.is_default = true
   );

UPDATE orgs
   SET default_team_id = defaults.id,
       updated_at = now()
  FROM (
    SELECT org_id, id
      FROM teams
     WHERE is_default = true
  ) defaults
 WHERE orgs.id = defaults.org_id
   AND orgs.default_team_id IS NULL;

UPDATE orgs
   SET slug = lower(regexp_replace(display_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || right(id, 6)
 WHERE slug IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'orgs_default_team_id_fk'
  ) THEN
    ALTER TABLE orgs
      ADD CONSTRAINT orgs_default_team_id_fk
      FOREIGN KEY (default_team_id) REFERENCES teams (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  team_id text NOT NULL REFERENCES teams (id) ON DELETE RESTRICT,
  parent_agent_id text REFERENCES agents (id) ON DELETE SET NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deactivated', 'retired', 'suspended')),
  description text NOT NULL DEFAULT '',
  labels jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(labels) = 'array'),
  default_environment text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by_member_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agents_org_team_idx ON agents (org_id, team_id);
CREATE INDEX IF NOT EXISTS agents_org_parent_idx ON agents (org_id, parent_agent_id);
CREATE INDEX IF NOT EXISTS agents_org_status_idx ON agents (org_id, status);

CREATE TABLE IF NOT EXISTS connections (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  created_by text,
  kind text NOT NULL CHECK (
    kind IN ('mcp_local', 'mcp_remote', 'mcp_http', 'api_key', 'sdk', 'cli', 'proxy', 'manual_observe')
  ),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  secret_last4 text,
  secret_revealed_at timestamptz,
  last_tested_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connections_org_agent_idx ON connections (org_id, agent_id);
CREATE INDEX IF NOT EXISTS connections_org_status_idx ON connections (org_id, status);

CREATE TABLE IF NOT EXISTS connection_credentials (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  connection_id text NOT NULL REFERENCES connections (id) ON DELETE RESTRICT,
  secret_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS connection_credentials_hash_idx
  ON connection_credentials (secret_hash);

CREATE INDEX IF NOT EXISTS connection_credentials_connection_idx
  ON connection_credentials (connection_id, status);

CREATE TABLE IF NOT EXISTS wallet_refs (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  provider text NOT NULL,
  external_wallet_id text,
  address text,
  chain text,
  label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'attached' CHECK (status IN ('attached', 'detached')),
  attached_at timestamptz NOT NULL DEFAULT now(),
  detached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_refs_active_unique_idx
  ON wallet_refs (
    org_id,
    agent_id,
    provider,
    COALESCE(external_wallet_id, ''),
    COALESCE(address, ''),
    COALESCE(chain, '')
  )
  WHERE status = 'attached';

CREATE INDEX IF NOT EXISTS wallet_refs_org_agent_idx ON wallet_refs (org_id, agent_id, status);
