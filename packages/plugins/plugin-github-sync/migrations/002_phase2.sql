-- Plugin: @paperclipai/plugin-github-sync
-- Migration: 002_phase2
--
-- Phase 2 schema additions:
--   - gh_check_mirrors  : latest check_run/check_suite/workflow_run state
--   - gh_branch_mirrors : branch tracking with head SHA
--   - gh_outbound_audit : one row per outbound write tool invocation
--
-- Also adds a `raw` jsonb column to gh_repo_links (used by workflow_run and
-- check_run handlers to store latest CI state before gh_check_mirrors is
-- populated by the sync engine).

-- ---------------------------------------------------------------------------
-- gh_repo_links: add raw JSONB column for transient CI state
-- ---------------------------------------------------------------------------
ALTER TABLE plugin_github_sync_60491d4d6b.gh_repo_links
  ADD COLUMN IF NOT EXISTS raw jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- gh_check_mirrors
-- ---------------------------------------------------------------------------
CREATE TABLE plugin_github_sync_60491d4d6b.gh_check_mirrors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_link_id      uuid NOT NULL REFERENCES plugin_github_sync_60491d4d6b.gh_repo_links(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('check_run', 'check_suite', 'workflow_run')),
  external_id       bigint NOT NULL,
  name              text NOT NULL,
  head_sha          text,
  head_branch       text,
  status            text NOT NULL,
  conclusion        text,
  details_url       text,
  started_at        timestamptz,
  completed_at      timestamptz,
  raw               jsonb NOT NULL,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo_link_id, kind, external_id)
);

CREATE INDEX gh_check_mirrors_repo_idx
  ON plugin_github_sync_60491d4d6b.gh_check_mirrors (repo_link_id);

CREATE INDEX gh_check_mirrors_kind_idx
  ON plugin_github_sync_60491d4d6b.gh_check_mirrors (repo_link_id, kind);

CREATE INDEX gh_check_mirrors_head_sha_idx
  ON plugin_github_sync_60491d4d6b.gh_check_mirrors (repo_link_id, head_sha);

-- ---------------------------------------------------------------------------
-- gh_branch_mirrors
-- ---------------------------------------------------------------------------
CREATE TABLE plugin_github_sync_60491d4d6b.gh_branch_mirrors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_link_id      uuid NOT NULL REFERENCES plugin_github_sync_60491d4d6b.gh_repo_links(id) ON DELETE CASCADE,
  ref               text NOT NULL,
  head_sha          text NOT NULL,
  protected         boolean NOT NULL DEFAULT false,
  deleted_at        timestamptz,
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo_link_id, ref)
);

CREATE INDEX gh_branch_mirrors_repo_idx
  ON plugin_github_sync_60491d4d6b.gh_branch_mirrors (repo_link_id);

-- ---------------------------------------------------------------------------
-- gh_outbound_audit
-- ---------------------------------------------------------------------------
CREATE TABLE plugin_github_sync_60491d4d6b.gh_outbound_audit (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor               text NOT NULL,
  tool                text NOT NULL,
  target_url          text NOT NULL,
  request_body_redacted text,
  response_status     integer,
  response_etag       text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  error               text
);

CREATE INDEX gh_outbound_audit_tool_idx
  ON plugin_github_sync_60491d4d6b.gh_outbound_audit (tool, started_at);

CREATE INDEX gh_outbound_audit_actor_idx
  ON plugin_github_sync_60491d4d6b.gh_outbound_audit (actor, started_at);
