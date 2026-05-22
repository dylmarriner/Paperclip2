/**
 * Initial import for a GitHub repository.
 *
 * Performs a full fetch of repo metadata, issues, PRs, branches, commits, and CI state.
 *
 * Invariants:
 *   - All writes use repo_link_id foreign key
 *   - Rate-limit handling pauses on X-RateLimit-Remaining: 0
 *   - Pagination follows Link headers with per_page=100
 *   - ETags stored for conditional requests on subsequent syncs
 *   - On failure: increment consecutive_failures, set status degraded after 3
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { PLUGIN_DB_NAMESPACE } from "../constants.js";
import { GitHubClient } from "../http/githubClient.js";
import type { AuthProvider } from "../auth/types.js";
import { waitForRateLimitReset, classifyHttpFailure } from "./rate-limit.js";
import { fetchPaginated } from "./pagination.js";

export interface InitialImportOptions {
  repoLinkId: string;
  repoOwner: string;
  repoName: string;
  companyId: string;
  auth: AuthProvider;
  fetchImpl: typeof fetch;
  recentCommitsPerBranch?: number;
  importMilestones?: boolean;
}

export interface InitialImportResult {
  success: boolean;
  issuesImported: number;
  prsImported: number;
  branchesImported: number;
  commitsImported: number;
  checksImported: number;
  error?: string;
}

export async function performInitialImport(
  ctx: PluginContext,
  options: InitialImportOptions,
): Promise<InitialImportResult> {
  const { repoLinkId, repoOwner, repoName, companyId, auth, fetchImpl, recentCommitsPerBranch = 100, importMilestones = false } = options;

  const client = new GitHubClient(auth, fetchImpl, ctx.logger);
  const result: InitialImportResult = {
    success: false,
    issuesImported: 0,
    prsImported: 0,
    branchesImported: 0,
    commitsImported: 0,
    checksImported: 0,
  };

  try {
    // 1. Fetch repository metadata
    const repo = await client.getRepository(repoOwner, repoName);
    await ctx.db.execute(
      `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       SET
         default_branch = $1,
         description = $2,
         private = $3,
         gh_updated_at = $4,
         raw = $5
       WHERE id = $6`,
      [
        repo.default_branch,
        repo.description,
        repo.private,
        repo.updated_at,
        JSON.stringify(repo),
        repoLinkId,
      ],
    );

    // 2. Fetch labels
    const labels = await client.listLabels(repoOwner, repoName);
    const labelNames = labels.map((l) => l.name);
    await ctx.db.execute(
      `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       SET labels = $1
       WHERE id = $2`,
      [JSON.stringify(labelNames), repoLinkId],
    );

    // 3. Fetch milestones (optional)
    if (importMilestones) {
      const milestones = await client.listMilestones(repoOwner, repoName);
      for (const milestone of milestones) {
        await ctx.db.execute(
          `INSERT INTO "${PLUGIN_DB_NAMESPACE}".gh_milestones
           (repo_link_id, gh_milestone_id, gh_number, title, description, state, due_on, gh_created_at, gh_updated_at, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (repo_link_id, gh_milestone_id)
           DO UPDATE SET
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             state = EXCLUDED.state,
             due_on = EXCLUDED.due_on,
             gh_updated_at = EXCLUDED.gh_updated_at,
             raw = EXCLUDED.raw`,
          [
            repoLinkId,
            milestone.id,
            milestone.number,
            milestone.title,
            milestone.description,
            milestone.state,
            milestone.due_on,
            milestone.created_at,
            milestone.updated_at,
            JSON.stringify(milestone),
          ],
        );
      }
    }

    // 4. Paginated fetch of open issues
    const issues = await client.listIssues(repoOwner, repoName, { state: "open", per_page: 100 });
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
    result.issuesImported = issues.length;

    // 5. Paginated fetch of open PRs
    const prs = await client.listPullRequests(repoOwner, repoName, { state: "open", per_page: 100 });
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
    result.prsImported = prs.length;

    // 6. Fetch branches
    const branches = await client.listBranches(repoOwner, repoName);
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
    result.branchesImported = branches.length;

    // 7. Fetch recent commits per branch
    for (const branch of branches) {
      const commits = await client.listCommits(repoOwner, repoName, { sha: branch.name, per_page: recentCommitsPerBranch });
      // TODO: Add activity.log when companyId is available in PluginContext
      // for (const commit of commits) {
      //   await ctx.activity.log({
      //     companyId,
      //     message: `Commit ${commit.sha.substring(0, 7)} on ${branch.name}`,
      //     entityType: "github.commit",
      //     entityId: commit.sha,
      //     metadata: {
      //       sha: commit.sha,
      //       message: commit.commit.message,
      //       author: commit.commit.author?.email,
      //       branch: branch.name,
      //       repoOwner,
      //       repoName,
      //     },
      //   });
      // }
      result.commitsImported += commits.length;
    }

    // 8. Fetch current workflow runs
    const workflowRunsResponse = await client.listWorkflowRuns(repoOwner, repoName, { per_page: 100 });
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
    result.checksImported = workflowRunsResponse.workflow_runs.length;

    // 9. Update last_synced_at
    await ctx.db.execute(
      `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       SET last_synced_at = now(), consecutive_failures = 0, status = 'active'
       WHERE id = $1`,
      [repoLinkId],
    );

    result.success = true;
  } catch (error) {
    ctx.logger.error("Initial import failed", { error, repoLinkId, repoOwner, repoName });
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
