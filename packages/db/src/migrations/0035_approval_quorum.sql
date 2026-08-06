-- 0035_approval_quorum.sql
-- N-of-M approval quorum above a configurable threshold [manifest E4].
--
-- Phase 5 already shipped the actual control gap: requested_by <> approver
-- (self-approval is forbidden). Quorum is the additive SECOND layer -- for
-- a high-value action, ONE non-requester approver still is not enough.
--
-- required_approvals defaults to 1, preserving every existing single-vote
-- approval's behavior exactly: with required_approvals = 1, the first
-- non-self vote still transitions status to 'approved' immediately, same
-- as before this migration.

ALTER TABLE approval_requests
  ADD COLUMN required_approvals integer NOT NULL DEFAULT 1 CHECK (required_approvals >= 1);

-- One row per (approval, actor) that has voted to approve. UNIQUE is what
-- makes "the same operator cannot vote twice toward quorum" a database
-- guarantee -- a second vote from the same actor violates the constraint
-- rather than relying on application code to have remembered to check.
CREATE TABLE IF NOT EXISTS approval_votes (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
  approval_id text NOT NULL REFERENCES approval_requests (id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_id, actor_id)
);

CREATE INDEX IF NOT EXISTS approval_votes_approval_idx
  ON approval_votes (approval_id);
