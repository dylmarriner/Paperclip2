-- Plugin: @paperclipai/plugin-github-sync
-- Migration: 001_init
--
-- Phase 1 schema for the GitHub Sync plugin.
--
-- Schema name is derived deterministically at install time by the host as
--   plugin_<namespaceSlug>_<sha256(pluginId).slice(0,10)>
-- For this plugin (pluginId = "paperclip-plugin-github-sync",
-- namespaceSlug = "github_sync") that resolves to:
--   plugin_github_sync_60491d4d6b
-- All identifiers below are fully qualified per
-- server/src/services/plugin-database.ts::validatePluginMigrationStatement.
--
-- Tables introduced:
--   - gh_repo_links         : binding from a Paperclip project to a GitHub repo
--   - gh_issue_mirrors      : shadow of GitHub issues (read-from-GitHub)
--   - gh_pr_mirrors         : shadow of GitHub pull requests (read-from-GitHub)
--   - gh_webhook_deliveries : worker-side idempotency for X-GitHub-Delivery IDs
--
-- Phase 2 will add: gh_check_mirrors, gh_branch_mirrors, gh_outbound_audit.
-- Phase 3 will add: gh_issue_ticket_links, gh_pr_task_links.

-- ---------------------------------------------------------------------------
-- gh_repo_links
-- ---------------------------------------------------------------------------
CREATE TABLE plugin_github_sync_60491d4d6b.gh_repo_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  installation_id       text NOT NULL,
  repo_owner            text NOT NULL,
  repo_name             text NOT NULL,
  repo_full_name        text NOT NULL,
  repo_github_id        bigint NOT NULL,
  default_branch        text,
  html_url              text NOT NULL,
  protected_branches    jsonb NOT NULL DEFAULT '["main","master","release/*"]'::jsonb,
  labels                jsonb NOT NULL DEFAULT '[]'::jsonb,
  etags                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                text NOT NULL DEFAULT 'active',
  consecutive_failures  integer NOT NULL DEFAULT 0,
  last_synced_at        timestamptz,
  last_error            text,
  connected_at          timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, repo_github_id)
);

CREATE INDEX gh_repo_links_company_idx
  ON plugin_github_sync_60491d4d6b.gh_repo_links (company_id);

CREATE INDEX gh_repo_links_project_idx
  ON plugin_github_sync_60491d4d6b.gh_repo_links (project_id);

CREATE INDEX gh_repo_links_installation_idx
  ON plugin_github_sync_60491d4d6b.gh_repo_links (installation_id);

-- ---------------------------------------------------------------------------
-- gh_issue_mirrors
-- ---------------------------------------------------------------------------
CREATE TABLE plugin_github_sync_60491d4d6b.gh_issue_mirrors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_link_id      uuid NOT NULL REFERENCES plugin_github_sync_60491d4d6b.gh_repo_links(id) ON DELETE CASCADE,
  gh_issue_id       bigint NOT NULL,
  gh_number         integer NOT NULL,
  title             text NOT NULL,
  body              text,
  body_hash         text,
  state             text NOT NULL,
  state_reason      text,
  author_login      text,
  assignee_logins   jsonb NOT NULL DEFAULT '[]'::jsonb,
  labels            jsonb NOT NULL DEFAULT '[]'::jsonb,
  milestone         jsonb,
  html_url          text NOT NULL,
  gh_created_at     timestamptz NOT NULL,
  gh_updated_at     timestamptz NOT NULL,
  gh_closed_at      timestamptz,
  raw               jsonb NOT NULL,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo_link_id, gh_issue_id)
);

CREATE INDEX gh_issue_mirrors_repo_idx
  ON plugin_github_sync_60491d4d6b.gh_issue_mirrors (repo_link_id);

CREATE INDEX gh_issue_mirrors_state_idx
  ON plugin_github_sync_60491d4d6b.gh_issue_mirrors (state);

CREATE INDEX gh_issue_mirrors_number_idx
  ON plugin_github_sync_60491d4d6b.gh_issue_mirrors (repo_link_id, gh_number);

-- ---------------------------------------------------------------------------
-- gh_pr_mirrors
-- ---------------------------------------------------------------------------
CREATE TABLE plugin_github_sync_60491d4d6b.gh_pr_mirrors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_link_id      uuid NOT NULL REFERENCES plugin_github_sync_60491d4d6b.gh_repo_links(id) ON DELETE CASCADE,
  gh_pr_id          bigint NOT NULL,
  gh_number         integer NOT NULL,
  title             text NOT NULL,
  body              text,
  body_hash         text,
  state             text NOT NULL,
  draft             boolean NOT NULL DEFAULT false,
  merged            boolean NOT NULL DEFAULT false,
  merged_at         timestamptz,
  merge_commit_sha  text,
  head_ref          text NOT NULL,
  head_sha          text NOT NULL,
  base_ref          text NOT NULL,
  author_login      text,
  assignee_logins   jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_reviewers jsonb NOT NULL DEFAULT '[]'::jsonb,
  labels            jsonb NOT NULL DEFAULT '[]'::jsonb,
  html_url          text NOT NULL,
  gh_created_at     timestamptz NOT NULL,
  gh_updated_at     timestamptz NOT NULL,
  gh_closed_at      timestamptz,
  raw               jsonb NOT NULL,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo_link_id, gh_pr_id)
);

CREATE INDEX gh_pr_mirrors_repo_idx
  ON plugin_github_sync_60491d4d6b.gh_pr_mirrors (repo_link_id);

CREATE INDEX gh_pr_mirrors_state_idx
  ON plugin_github_sync_60491d4d6b.gh_pr_mirrors (state);

CREATE INDEX gh_pr_mirrors_number_idx
  ON plugin_github_sync_60491d4d6b.gh_pr_mirrors (repo_link_id, gh_number);

CREATE INDEX gh_pr_mirrors_head_ref_idx
  ON plugin_github_sync_60491d4d6b.gh_pr_mirrors (repo_link_id, head_ref);

-- ---------------------------------------------------------------------------
-- gh_webhook_deliveries (worker-side idempotency)
--
-- The host's shared `plugin_webhook_deliveries` table records every inbound
-- delivery attempt for audit, but it does not enforce dedup on the
-- X-GitHub-Delivery header. This table holds plugin-local dedup so that
-- repeated deliveries (GitHub will retry on non-2xx) are processed at most
-- once. The worker INSERTs ON CONFLICT (delivery_id) DO NOTHING and skips
-- the handler when no row is returned.
-- ---------------------------------------------------------------------------
CREATE TABLE plugin_github_sync_60491d4d6b.gh_webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id     text NOT NULL UNIQUE,
  event           text NOT NULL,
  action          text,
  repo_full_name  text,
  repo_link_id    uuid REFERENCES plugin_github_sync_60491d4d6b.gh_repo_links(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'received',
  error           text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

CREATE INDEX gh_webhook_deliveries_event_idx
  ON plugin_github_sync_60491d4d6b.gh_webhook_deliveries (event);

CREATE INDEX gh_webhook_deliveries_repo_idx
  ON plugin_github_sync_60491d4d6b.gh_webhook_deliveries (repo_full_name);
