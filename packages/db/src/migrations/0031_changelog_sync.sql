-- 0031_changelog_sync.sql
-- Public engineering changelog: mirrors GitHub repository, branch, commit,
-- and pull request activity for the configured org/repos into a single
-- polymorphic table, plus a per-repo precomputed projection the page reads
-- directly (rendering never re-aggregates raw activity at request time).

CREATE TABLE IF NOT EXISTS changelog_activities (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('repository', 'branch', 'commit', 'pull_request')),
  platform_id text NOT NULL,
  repo_name text NOT NULL,
  branch_name text,
  author text NOT NULL,
  occurred_at timestamptz NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Generated so pull-request state filtering can use a real index instead
  -- of scanning the raw jsonb payload on every request.
  pr_state text GENERATED ALWAYS AS (raw ->> 'state') STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, platform_id)
);

CREATE INDEX IF NOT EXISTS changelog_activities_repo_kind_idx
  ON changelog_activities (repo_name, kind, occurred_at DESC);

CREATE INDEX IF NOT EXISTS changelog_activities_branch_idx
  ON changelog_activities (repo_name, branch_name)
  WHERE kind = 'commit';

CREATE INDEX IF NOT EXISTS changelog_activities_pr_state_idx
  ON changelog_activities (repo_name, pr_state)
  WHERE kind = 'pull_request';

-- Per-repo materialized projection (contribution calendar, commit graph,
-- contributors) recomputed after every sync so the page never aggregates
-- raw activity rows at request time.
CREATE TABLE IF NOT EXISTS changelog_metrics (
  repo_name text PRIMARY KEY,
  contribution_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  graph_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  contributors jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
