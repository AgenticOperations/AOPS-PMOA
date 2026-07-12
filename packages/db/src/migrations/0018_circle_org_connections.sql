UPDATE org_payment_modes
   SET mode = 'test',
       updated_at = now()
 WHERE mode <> 'test';

ALTER TABLE org_payment_modes DROP CONSTRAINT IF EXISTS org_payment_modes_mode_check;
ALTER TABLE org_payment_modes
  ADD CONSTRAINT org_payment_modes_mode_check CHECK (mode = 'test');

CREATE TABLE IF NOT EXISTS circle_org_connections (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  mode text NOT NULL DEFAULT 'test' CHECK (mode = 'test'),
  circle_email_hash text,
  profile_ciphertext text NOT NULL,
  profile_iv text NOT NULL,
  profile_tag text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'otp_pending', 'connected', 'expired', 'blocked')),
  verification_requested_at timestamptz,
  verified_at timestamptz,
  expires_at timestamptz,
  blocked_at timestamptz,
  last_error_code text,
  created_by_user_id text REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (org_id, mode)
);

CREATE UNIQUE INDEX IF NOT EXISTS circle_org_connections_active_email_unique_idx
  ON circle_org_connections (mode, circle_email_hash)
  WHERE mode = 'test'
    AND circle_email_hash IS NOT NULL
    AND status IN ('otp_pending', 'connected');

CREATE INDEX IF NOT EXISTS circle_org_connections_org_status_idx
  ON circle_org_connections (org_id, status);

CREATE TABLE IF NOT EXISTS circle_connection_challenges (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  connection_id text NOT NULL,
  mode text NOT NULL DEFAULT 'test' CHECK (mode = 'test'),
  request_bundle_ciphertext text NOT NULL,
  request_bundle_iv text NOT NULL,
  request_bundle_tag text NOT NULL,
  connection_revision integer NOT NULL CHECK (connection_revision > 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired', 'failed', 'blocked')),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  failed_at timestamptz,
  blocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT circle_connection_challenges_connection_fk
    FOREIGN KEY (connection_id, org_id)
    REFERENCES circle_org_connections (id, org_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS circle_connection_challenges_connection_status_idx
  ON circle_connection_challenges (connection_id, status);

CREATE INDEX IF NOT EXISTS circle_connection_challenges_org_user_idx
  ON circle_connection_challenges (org_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS circle_connection_challenges_expiry_idx
  ON circle_connection_challenges (status, expires_at);
