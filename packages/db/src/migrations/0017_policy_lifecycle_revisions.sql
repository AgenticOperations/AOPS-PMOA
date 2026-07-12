ALTER TABLE policy_versions
  DROP CONSTRAINT IF EXISTS policy_versions_status_check;

UPDATE policy_versions pv
   SET status = 'superseded'
  FROM (
    SELECT policy_id, org_id, max(version) AS current_version
      FROM policy_versions
     WHERE status = 'active'
     GROUP BY policy_id, org_id
  ) current
 WHERE pv.policy_id = current.policy_id
   AND pv.org_id = current.org_id
   AND pv.status = 'active'
   AND pv.version < current.current_version;

ALTER TABLE policy_versions
  ADD CONSTRAINT policy_versions_status_check CHECK (status IN ('active', 'superseded', 'archived'));

CREATE UNIQUE INDEX policy_versions_one_active_idx
  ON policy_versions (org_id, policy_id)
  WHERE status = 'active';

ALTER TABLE policy_drafts
  ADD COLUMN revision_policy_id text,
  ADD COLUMN revision_base_version integer,
  ADD COLUMN revision_mode text CHECK (revision_mode IN ('revision', 'restore')),
  ADD COLUMN revision_restore_bindings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(revision_restore_bindings) = 'array');

ALTER TABLE policy_drafts
  ADD CONSTRAINT policy_drafts_revision_fk
  FOREIGN KEY (revision_policy_id, revision_base_version)
  REFERENCES policy_versions (policy_id, version)
  ON DELETE RESTRICT;

ALTER TABLE policy_bindings
  ADD COLUMN removed_reason text;
