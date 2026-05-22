-- Phase 3: Linking tables for GitHub ↔ Paperclip ticket/task connections
-- These tables bridge GitHub issues/PRs to Paperclip issues table

-- Bridge GitHub issues to Paperclip tickets
CREATE TABLE IF NOT EXISTS gh_issue_ticket_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_link_id UUID NOT NULL REFERENCES plugin_github_sync_60491d4d6b.gh_repo_links(id) ON DELETE CASCADE,
  gh_issue_id BIGINT NOT NULL,
  paperclip_issue_id UUID NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (repo_link_id, gh_issue_id),
  UNIQUE (repo_link_id, paperclip_issue_id)
);

-- Bridge GitHub PRs to Paperclip tasks (stored in issues table)
CREATE TABLE IF NOT EXISTS gh_pr_task_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_link_id UUID NOT NULL REFERENCES plugin_github_sync_60491d4d6b.gh_repo_links(id) ON DELETE CASCADE,
  gh_pr_id BIGINT NOT NULL,
  paperclip_issue_id UUID NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (repo_link_id, gh_pr_id),
  UNIQUE (repo_link_id, paperclip_issue_id)
);

-- Indexes for lookup performance
CREATE INDEX IF NOT EXISTS gh_issue_ticket_links_repo_link_id_idx ON gh_issue_ticket_links(repo_link_id);
CREATE INDEX IF NOT EXISTS gh_issue_ticket_links_paperclip_issue_id_idx ON gh_issue_ticket_links(paperclip_issue_id);
CREATE INDEX IF NOT EXISTS gh_pr_task_links_repo_link_id_idx ON gh_pr_task_links(repo_link_id);
CREATE INDEX IF NOT EXISTS gh_pr_task_links_paperclip_issue_id_idx ON gh_pr_task_links(paperclip_issue_id);
