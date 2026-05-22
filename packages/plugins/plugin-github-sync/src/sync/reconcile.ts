/**
 * Reconciliation sync for GitHub repositories.
 *
 * Periodic refresh of data since last_synced_at with a 24h overlap window.
 *
 * Invariants:
 *   - Runs every 15 minutes via manifest job
 *   - Processes only repos with status = "active"
 *   - Uses 24h overlap window to catch missed webhooks
 *   - On failure: increment consecutive_failures, set status degraded after 3
 *   - Success resets consecutive_failures counter
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { PLUGIN_DB_NAMESPACE } from "../constants.js";
import { GitHubClient } from "../http/githubClient.js";
import type { AuthProvider } from "../auth/types.js";

export interface ReconcileOptions {
  repoLinkId: string;
  repoOwner: string;
  repoName: string;
  companyId: string;
  auth: AuthProvider;
  fetchImpl: typeof fetch;
  overlapHours?: number;
}

export interface ReconcileResult {
  success: boolean;
  issuesUpdated: number;
  prsUpdated: number;
  branchesUpdated: number;
  checksUpdated: number;
  error?: string;
}

export async function performReconcile(
  ctx: PluginContext,
  options: ReconcileOptions,
): Promise<ReconcileResult> {
  const { repoLinkId, repoOwner, repoName, companyId, auth, fetchImpl, overlapHours = 24 } = options;

  const client = new GitHubClient(auth, fetchImpl, ctx.logger);
  const result: ReconcileResult = {
    success: false,
    issuesUpdated: 0,
    prsUpdated: 0,
    branchesUpdated: 0,
    checksUpdated: 0,
  };

  try {
    // Get last_synced_at and default_branch from gh_repo_links
    const repoRows = await ctx.db.query<{ last_synced_at: string; default_branch: string }>(
      `SELECT last_synced_at, default_branch FROM "${PLUGIN_DB_NAMESPACE}".gh_repo_links WHERE id = $1`,
      [repoLinkId],
    );

    if (!repoRows.length) {
      throw new Error(`Repo link not found: ${repoLinkId}`);
    }

    const lastSyncedAt = repoRows[0].last_synced_at;
    const overlapDate = new Date(Date.now() - overlapHours * 60 * 60 * 1000).toISOString();

    // 1. List issues updated since overlap window
    const issues = await client.listIssues(repoOwner, repoName, {
      state: "all",
      per_page: 100,
    });

    for (const issue of issues) {
      const labels = issue.labels.map((l) => l.name);
      await ctx.db.execute(
        `INSERT INTO "${PLUGIN_DB_NAMESPACE}".gh_issue_mirrors
         (repo_link_id, gh_issue_id, gh_number, title, body, state, state_reason,
          labels, author_login, html_url, gh_created_at, gh_updated_at, gh_closed_at, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (repo_link_id, gh_issue_id)
         DO UPDATE SET
           title = EXCLUDED.title,
           body = EXCLUDED.body,
           state = EXCLUDED.state,
           state_reason = EXCLUDED.state_reason,
           labels = EXCLUDED.labels,
           author_login = EXCLUDED.author_login,
           html_url = EXCLUDED.html_url,
           gh_updated_at = EXCLUDED.gh_updated_at,
           gh_closed_at = EXCLUDED.gh_closed_at,
           raw = EXCLUDED.raw,
           last_seen_at = now()`,
        [
          repoLinkId,
          issue.id,
          issue.number,
          issue.title,
          issue.body,
          issue.state,
          issue.state_reason,
          JSON.stringify(labels),
          issue.user?.login ?? null,
          `https://github.com/${repoOwner}/${repoName}/issues/${issue.number}`,
          issue.created_at,
          issue.updated_at,
          issue.closed_at,
          JSON.stringify(issue),
        ],
      );
    }
    result.issuesUpdated = issues.length;

    // 2. Same for PRs
    const prs = await client.listPullRequests(repoOwner, repoName, {
      state: "all",
      per_page: 100,
    });

    for (const pr of prs) {
      const labels = pr.labels.map((l) => l.name);
      await ctx.db.execute(
        `INSERT INTO "${PLUGIN_DB_NAMESPACE}".gh_pr_mirrors
         (repo_link_id, gh_pr_id, gh_number, title, body, state, draft, merged,
          merge_commit_sha, head_ref, head_sha, base_ref, author_login, labels,
          html_url, gh_created_at, gh_updated_at, gh_closed_at, merged_at, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         ON CONFLICT (repo_link_id, gh_pr_id)
         DO UPDATE SET
           title = EXCLUDED.title,
           body = EXCLUDED.body,
           state = EXCLUDED.state,
           draft = EXCLUDED.draft,
           merged = EXCLUDED.merged,
           merge_commit_sha = EXCLUDED.merge_commit_sha,
           head_sha = EXCLUDED.head_sha,
           base_ref = EXCLUDED.base_ref,
           labels = EXCLUDED.labels,
           gh_updated_at = EXCLUDED.gh_updated_at,
           gh_closed_at = EXCLUDED.gh_closed_at,
           merged_at = EXCLUDED.merged_at,
           raw = EXCLUDED.raw,
           last_seen_at = now()`,
        [
          repoLinkId,
          pr.id,
          pr.number,
          pr.title,
          pr.body,
          pr.state,
          pr.draft,
          pr.merged,
          pr.merge_commit_sha,
          pr.head.ref,
          pr.head.sha,
          pr.base.ref,
          pr.user?.login ?? null,
          JSON.stringify(labels),
          pr.html_url,
          pr.created_at,
          pr.updated_at,
          pr.closed_at,
          pr.merged_at,
          JSON.stringify(pr),
        ],
      );
    }
    result.prsUpdated = prs.length;

    // 3. Refresh branch list; mark deleted branches
    const branches = await client.listBranches(repoOwner, repoName);
    const currentBranchNames = new Set(branches.map((b) => b.name));

    // Mark branches not in current list as deleted
    await ctx.db.execute(
      `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_branch_mirrors
       SET deleted_at = now()
       WHERE repo_link_id = $1 AND ref NOT IN (${branches.map(() => "?").join(",")})`,
      [repoLinkId, ...branches.map((b) => b.name)],
    );

    // Upsert current branches
    for (const branch of branches) {
      await ctx.db.execute(
        `INSERT INTO "${PLUGIN_DB_NAMESPACE}".gh_branch_mirrors
         (repo_link_id, ref, head_sha, protected, last_seen_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (repo_link_id, ref)
         DO UPDATE SET
           head_sha = EXCLUDED.head_sha,
           protected = EXCLUDED.protected,
           deleted_at = NULL,
           last_seen_at = now()`,
        [repoLinkId, branch.name, branch.commit.sha, branch.protected],
      );
    }
    result.branchesUpdated = branches.length;

    // 4. Refresh latest workflow_run / check_run for default branch + open PR heads
    const defaultBranch = repoRows[0].default_branch;
    const targetRefs = [defaultBranch, ...prs.filter((pr) => pr.state === "open").map((pr) => pr.head.ref)];

    for (const ref of targetRefs) {
      const workflowRunsResponse = await client.listWorkflowRuns(repoOwner, repoName, {
        branch: ref,
        per_page: 10,
      });

      for (const run of workflowRunsResponse.workflow_runs) {
        await ctx.db.execute(
          `INSERT INTO "${PLUGIN_DB_NAMESPACE}".gh_check_mirrors
           (repo_link_id, kind, external_id, name, head_sha, head_branch, status, conclusion, details_url, started_at, completed_at, raw, first_seen_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
           ON CONFLICT (repo_link_id, kind, external_id)
           DO UPDATE SET
             status = EXCLUDED.status,
             conclusion = EXCLUDED.conclusion,
             completed_at = EXCLUDED.completed_at,
             raw = EXCLUDED.raw,
             last_seen_at = now()`,
          [
            repoLinkId,
            "workflow_run",
            run.id,
            run.name,
            run.head_sha,
            run.head_branch,
            run.status,
            run.conclusion,
            run.html_url,
            run.created_at,
            run.updated_at,
            JSON.stringify(run),
          ],
        );
      }
      result.checksUpdated += workflowRunsResponse.workflow_runs.length;
    }

    // 5. Update last_synced_at and reset consecutive_failures on success
    await ctx.db.execute(
      `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       SET last_synced_at = now(), consecutive_failures = 0, status = 'active'
       WHERE id = $1`,
      [repoLinkId],
    );

    result.success = true;
  } catch (error) {
    ctx.logger.error("Reconciliation failed", { error, repoLinkId, repoOwner, repoName });
    result.error = error instanceof Error ? error.message : String(error);

    // Increment consecutive_failures
    await ctx.db.execute(
      `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       SET consecutive_failures = consecutive_failures + 1,
           status = CASE WHEN consecutive_failures + 1 >= 3 THEN 'degraded' ELSE status END
       WHERE id = $1`,
      [repoLinkId],
    );
  }

  return result;
}
