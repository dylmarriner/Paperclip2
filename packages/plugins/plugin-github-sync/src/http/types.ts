/**
 * Minimal GitHub API response types used by the sync plugin.
 *
 * These are intentionally narrow — only fields the plugin actually
 * reads are typed. Unknown fields are captured in `raw` jsonb columns
 * in the mirror tables for future use.
 */

export interface GitHubUserRef {
  login: string;
  id: number;
  type?: string;
}

export interface GitHubRepository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: GitHubUserRef;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

export interface GitHubIssue {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  state_reason: string | null;
  user: GitHubUserRef | null;
  labels: Array<{ id?: number; node_id?: string; name: string; color?: string; description?: string | null }>;
  assignees: GitHubUserRef[];
  milestone: GitHubMilestone | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface GitHubPullRequest {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  merged: boolean;
  merge_commit_sha: string | null;
  head: { ref: string; sha: string; repo: GitHubRepository | null };
  base: { ref: string; sha: string; repo: GitHubRepository | null };
  user: GitHubUserRef | null;
  labels: Array<{ id?: number; name: string; color?: string }>;
  assignees: GitHubUserRef[];
  requested_reviewers: GitHubUserRef[];
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
}

export interface GitHubCommit {
  sha: string;
  node_id: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string } | null;
    committer: { name: string; email: string; date: string } | null;
  };
  author: GitHubUserRef | null;
  html_url: string;
}

export interface GitHubLabel {
  id: number;
  node_id: string;
  name: string;
  description: string | null;
  color: string;
}

export interface GitHubMilestone {
  id: number;
  number: number;
  title: string;
  description: string | null;
  state: string;
  due_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string | null;
  html_url: string;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  node_id: string;
  head_branch: string;
  head_sha: string;
  run_number: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
}

export interface GitHubComment {
  id: number;
  user: GitHubUserRef;
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}
