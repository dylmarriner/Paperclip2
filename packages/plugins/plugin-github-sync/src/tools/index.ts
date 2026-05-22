/**
 * Plugin tools exposed to Paperclip agents.
 *
 * Each exported function is a factory that receives the plugin context from
 * the setup closure and returns a handler conforming to the SDK's
 * `(params, runCtx) => Promise<ToolResult>` signature.
 *
 * Tools implemented (Commit C):
 *   - github.connectRepository: Link a GitHub repo to the current Paperclip company
 *   - github.disconnectRepository: Unlink a repo
 *   - github.listRepositories: List linked repos for the company
 *
 * Tools implemented (Phase 2):
 *   - github.syncRepository: Trigger initial import for a linked repo
 *   - github.reconcileRepository: Trigger reconciliation for a linked repo
 *   - github.listIssues: List issues from a GitHub repo
 *   - github.listPullRequests: List pull requests from a GitHub repo
 *   - github.getWorkflowStatus: Get CI workflow status for a repo
 * - github.getRecentCommits: Get recent commits from a GitHub repo
 * - github.getChangedFilesForPullRequest: Get changed files for a PR
 */
import type { PluginContext, ToolRunContext, ToolResult } from "@paperclipai/plugin-sdk";
import { PLUGIN_DB_NAMESPACE } from "../constants.js";
import { performInitialImport, type InitialImportOptions } from "../sync/index.js";
import { performReconcile, type ReconcileOptions } from "../sync/index.js";
import { createAuthProvider, type ResolvedSecrets } from "../auth/index.js";
import { parseConfigOrThrow } from "../config/validate.js";
import type { GitHubSyncConfig } from "../config/schema.js";
import {
  recordAuditIntent,
  recordAuditResult,
  redactHeaders,
  generateAuditId,
} from "../audit/outbound-writes.js";

export interface ConnectRepositoryParams {
  repoOwner: string;
  repoName: string;
}

export function makeConnectRepository(ctx: PluginContext) {
  return async function (
    params: unknown,
    runCtx: ToolRunContext,
  ): Promise<ToolResult> {
    const p = params as ConnectRepositoryParams;
    await ctx.db.execute(
      `INSERT INTO "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       (company_id, repo_owner, repo_name, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (company_id, repo_owner, repo_name) DO NOTHING`,
      [runCtx.companyId, p.repoOwner, p.repoName],
    );
    return {
      content: `Repository ${p.repoOwner}/${p.repoName} connected.`,
      data: { repoOwner: p.repoOwner, repoName: p.repoName },
    };
  };
}

export interface DisconnectRepositoryParams {
  repoOwner: string;
  repoName: string;
}

export function makeDisconnectRepository(ctx: PluginContext) {
  return async function (
    params: unknown,
    runCtx: ToolRunContext,
  ): Promise<ToolResult> {
    const p = params as DisconnectRepositoryParams;
    const result = await ctx.db.execute(
      `DELETE FROM "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       WHERE company_id = $1 AND repo_owner = $2 AND repo_name = $3`,
      [runCtx.companyId, p.repoOwner, p.repoName],
    );
    return {
      content: result.rowCount > 0
        ? `Repository ${p.repoOwner}/${p.repoName} disconnected.`
        : `Repository ${p.repoOwner}/${p.repoName} was not linked.`,
      data: { deleted: result.rowCount > 0 },
    };
  };
}

export function makeListRepositories(ctx: PluginContext) {
  return async function (_params: unknown, runCtx: ToolRunContext): Promise<ToolResult> {
    const rows = await ctx.db.query<
      { repo_owner: string; repo_name: string; created_at: string; updated_at: string }
    >(
      `SELECT repo_owner, repo_name, created_at, updated_at
       FROM "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       WHERE company_id = $1
       ORDER BY updated_at DESC`,
      [runCtx.companyId],
    );

    const repos = rows.map((r) => ({
      repoOwner: r.repo_owner,
      repoName: r.repo_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return {
      content: `Found ${repos.length} linked repositories.`,
      data: { repos },
    };
  };
}

// ----------------------------------------------------------------------
// Phase 2 Tools
// ----------------------------------------------------------------------

export interface SyncRepositoryParams {
  repoOwner: string;
  repoName: string;
}

export function makeSyncRepository(ctx: PluginContext) {
  return async function (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as SyncRepositoryParams;

    // Resolve repo_link_id
    const repoLinkRows = await ctx.db.query<{ id: string }>(
      `SELECT id FROM "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       WHERE company_id = $1 AND repo_owner = $2 AND repo_name = $3`,
      [runCtx.companyId, p.repoOwner, p.repoName],
    );

    if (!repoLinkRows.length) {
      return {
        content: `Repository ${p.repoOwner}/${p.repoName} is not linked.`,
        error: "Repository not linked",
      };
    }

    const repoLinkId = repoLinkRows[0].id;

    // Resolve config and secrets
    const rawConfig = await ctx.config.get();
    const config = parseConfigOrThrow(rawConfig);

    const privateKey = config.privateKeySecretRef
      ? await ctx.secrets.resolve(config.privateKeySecretRef).catch(() => undefined)
      : undefined;
    const pat = config.patSecretRef
      ? await ctx.secrets.resolve(config.patSecretRef).catch(() => undefined)
      : undefined;
    const webhookSecret = await ctx.secrets.resolve(config.webhookSecretRef).catch(() => undefined);

    const secrets: ResolvedSecrets = {
      privateKey: privateKey ?? undefined,
      webhookSecret: webhookSecret ?? "",
      pat: pat ?? undefined,
    };

    const auth = createAuthProvider(config, secrets, ctx.http.fetch as any);

    const importOptions: InitialImportOptions = {
      repoLinkId,
      repoOwner: p.repoOwner,
      repoName: p.repoName,
      companyId: runCtx.companyId,
      auth,
      fetchImpl: ctx.http.fetch as any,
      recentCommitsPerBranch: 100,
      importMilestones: false,
    };

    const result = await performInitialImport(ctx, importOptions);

    if (result.success) {
      return {
        content: `Imported ${result.issuesImported} issues, ${result.prsImported} PRs, ${result.branchesImported} branches, ${result.commitsImported} commits, ${result.checksImported} CI runs.`,
        data: result,
      };
    } else {
      return {
        content: `Import failed: ${result.error}`,
        error: result.error,
      };
    }
  };
}

export interface ReconcileRepositoryParams {
  repoOwner: string;
  repoName: string;
}

export function makeReconcileRepository(ctx: PluginContext) {
  return async function (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as ReconcileRepositoryParams;

    // Resolve repo_link_id
    const repoLinkRows = await ctx.db.query<{ id: string }>(
      `SELECT id FROM "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       WHERE company_id = $1 AND repo_owner = $2 AND repo_name = $3`,
      [runCtx.companyId, p.repoOwner, p.repoName],
    );

    if (!repoLinkRows.length) {
      return {
        content: `Repository ${p.repoOwner}/${p.repoName} is not linked.`,
        error: "Repository not linked",
      };
    }

    const repoLinkId = repoLinkRows[0].id;

    // Resolve config and secrets
    const rawConfig = await ctx.config.get();
    const config = parseConfigOrThrow(rawConfig);

    const privateKey = config.privateKeySecretRef
      ? await ctx.secrets.resolve(config.privateKeySecretRef).catch(() => undefined)
      : undefined;
    const pat = config.patSecretRef
      ? await ctx.secrets.resolve(config.patSecretRef).catch(() => undefined)
      : undefined;
    const webhookSecret = await ctx.secrets.resolve(config.webhookSecretRef).catch(() => undefined);

    const secrets: ResolvedSecrets = {
      privateKey: privateKey ?? undefined,
      webhookSecret: webhookSecret ?? "",
      pat: pat ?? undefined,
    };

    const auth = createAuthProvider(config, secrets, ctx.http.fetch as any);

    const reconcileOptions: ReconcileOptions = {
      repoLinkId,
      repoOwner: p.repoOwner,
      repoName: p.repoName,
      companyId: runCtx.companyId,
      auth,
      fetchImpl: ctx.http.fetch as any,
      overlapHours: 24,
    };

    const result = await performReconcile(ctx, reconcileOptions);

    if (result.success) {
      return {
        content: `Reconciled ${result.issuesUpdated} issues, ${result.prsUpdated} PRs, ${result.branchesUpdated} branches, ${result.checksUpdated} CI runs.`,
        data: result,
      };
    } else {
      return {
        content: `Reconciliation failed: ${result.error}`,
        error: result.error,
      };
    }
  };
}

export interface ListIssuesParams {
  repoOwner: string;
  repoName: string;
  state?: "open" | "closed" | "all";
}

export function makeListIssues(ctx: PluginContext) {
  return async function (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as ListIssuesParams;

    // Resolve config and secrets
    const rawConfig = await ctx.config.get();
    const config = parseConfigOrThrow(rawConfig);

    const privateKey = config.privateKeySecretRef
      ? await ctx.secrets.resolve(config.privateKeySecretRef).catch(() => undefined)
      : undefined;
    const pat = config.patSecretRef
      ? await ctx.secrets.resolve(config.patSecretRef).catch(() => undefined)
      : undefined;
    const webhookSecret = await ctx.secrets.resolve(config.webhookSecretRef).catch(() => undefined);

    const secrets: ResolvedSecrets = {
      privateKey: privateKey ?? undefined,
      webhookSecret: webhookSecret ?? "",
      pat: pat ?? undefined,
    };

    const auth = createAuthProvider(config, secrets, ctx.http.fetch as any);

    const { GitHubClient } = await import("../http/githubClient.js");
    const client = new GitHubClient(auth, ctx.http.fetch as any, ctx.logger);

    const issues = await client.listIssues(p.repoOwner, p.repoName, {
      state: p.state ?? "open",
      per_page: 100,
    });

    return {
      content: `Found ${issues.length} issues.`,
      data: {
        issues: issues.map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          author: i.user?.login,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
        })),
      },
    };
  };
}

export interface ListPullRequestsParams {
  repoOwner: string;
  repoName: string;
  state?: "open" | "closed" | "all";
}

export function makeListPullRequests(ctx: PluginContext) {
  return async function (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as ListPullRequestsParams;

    // Resolve config and secrets
    const rawConfig = await ctx.config.get();
    const config = parseConfigOrThrow(rawConfig);

    const privateKey = config.privateKeySecretRef
      ? await ctx.secrets.resolve(config.privateKeySecretRef).catch(() => undefined)
      : undefined;
    const pat = config.patSecretRef
      ? await ctx.secrets.resolve(config.patSecretRef).catch(() => undefined)
      : undefined;
    const webhookSecret = await ctx.secrets.resolve(config.webhookSecretRef).catch(() => undefined);

    const secrets: ResolvedSecrets = {
      privateKey: privateKey ?? undefined,
      webhookSecret: webhookSecret ?? "",
      pat: pat ?? undefined,
    };

    const auth = createAuthProvider(config, secrets, ctx.http.fetch as any);

    const { GitHubClient } = await import("../http/githubClient.js");
    const client = new GitHubClient(auth, ctx.http.fetch as any, ctx.logger);

    const prs = await client.listPullRequests(p.repoOwner, p.repoName, {
      state: p.state ?? "open",
      per_page: 100,
    });

    return {
      content: `Found ${prs.length} pull requests.`,
      data: {
        pullRequests: prs.map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft,
          merged: pr.merged,
          author: pr.user?.login,
          headRef: pr.head.ref,
          baseRef: pr.base.ref,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
        })),
      },
    };
  };
}

export interface GetWorkflowStatusParams {
  repoOwner: string;
  repoName: string;
  branch?: string;
}

export function makeGetWorkflowStatus(ctx: PluginContext) {
  return async function (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as GetWorkflowStatusParams;

    // Resolve config and secrets
    const rawConfig = await ctx.config.get();
    const config = parseConfigOrThrow(rawConfig);

    const privateKey = config.privateKeySecretRef
      ? await ctx.secrets.resolve(config.privateKeySecretRef).catch(() => undefined)
      : undefined;
    const pat = config.patSecretRef
      ? await ctx.secrets.resolve(config.patSecretRef).catch(() => undefined)
      : undefined;
    const webhookSecret = await ctx.secrets.resolve(config.webhookSecretRef).catch(() => undefined);

    const secrets: ResolvedSecrets = {
      privateKey: privateKey ?? undefined,
      webhookSecret: webhookSecret ?? "",
      pat: pat ?? undefined,
    };

    const auth = createAuthProvider(config, secrets, ctx.http.fetch as any);

    const { GitHubClient } = await import("../http/githubClient.js");
    const client = new GitHubClient(auth, ctx.http.fetch as any, ctx.logger);

    const workflowRunsResponse = await client.listWorkflowRuns(p.repoOwner, p.repoName, {
      branch: p.branch,
      per_page: 10,
    });

    return {
      content: `Found ${workflowRunsResponse.workflow_runs.length} workflow runs.`,
      data: {
        workflowRuns: workflowRunsResponse.workflow_runs.map((run) => ({
          id: run.id,
          name: run.name,
          status: run.status,
          conclusion: run.conclusion,
          headBranch: run.head_branch,
          headSha: run.head_sha,
          createdAt: run.created_at,
          updatedAt: run.updated_at,
        })),
      },
    };
  };
}

export interface GetRecentCommitsParams {
  repoOwner: string;
  repoName: string;
  branch?: string;
  limit?: number;
}

export function makeGetRecentCommits(ctx: PluginContext) {
  return async function (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as GetRecentCommitsParams;

    // Resolve config and secrets
    const rawConfig = await ctx.config.get();
    const config = parseConfigOrThrow(rawConfig);

    const privateKey = config.privateKeySecretRef
      ? await ctx.secrets.resolve(config.privateKeySecretRef).catch(() => undefined)
      : undefined;
    const pat = config.patSecretRef
      ? await ctx.secrets.resolve(config.patSecretRef).catch(() => undefined)
      : undefined;
    const webhookSecret = await ctx.secrets.resolve(config.webhookSecretRef).catch(() => undefined);

    const secrets: ResolvedSecrets = {
      privateKey: privateKey ?? undefined,
      webhookSecret: webhookSecret ?? "",
      pat: pat ?? undefined,
    };

    const auth = createAuthProvider(config, secrets, ctx.http.fetch as any);

    const { GitHubClient } = await import("../http/githubClient.js");
    const client = new GitHubClient(auth, ctx.http.fetch as any, ctx.logger);

    const commits = await client.listCommits(p.repoOwner, p.repoName, {
      sha: p.branch,
      per_page: p.limit ?? 20,
    });

    return {
      content: `Found ${commits.length} recent commits.`,
      data: {
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.commit.message,
          author: c.commit.author?.name,
          authorEmail: c.commit.author?.email,
          date: c.commit.author?.date,
        })),
      },
    };
  };
}

export interface GetChangedFilesForPullRequestParams {
  repoOwner: string;
  repoName: string;
  pullRequestNumber: number;
}

export function makeGetChangedFilesForPullRequest(ctx: PluginContext) {
  return async function (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as GetChangedFilesForPullRequestParams;

    // Resolve config and secrets
    const rawConfig = await ctx.config.get();
    const config = parseConfigOrThrow(rawConfig);

    const privateKey = config.privateKeySecretRef
      ? await ctx.secrets.resolve(config.privateKeySecretRef).catch(() => undefined)
      : undefined;
    const pat = config.patSecretRef
      ? await ctx.secrets.resolve(config.patSecretRef).catch(() => undefined)
      : undefined;
    const webhookSecret = await ctx.secrets.resolve(config.webhookSecretRef).catch(() => undefined);

    const secrets: ResolvedSecrets = {
      privateKey: privateKey ?? undefined,
      webhookSecret: webhookSecret ?? "",
      pat: pat ?? undefined,
    };

    const auth = createAuthProvider(config, secrets, ctx.http.fetch as any);

    const { GitHubClient } = await import("../http/githubClient.js");
    const client = new GitHubClient(auth, ctx.http.fetch as any, ctx.logger);

    const files = await client.getPullRequestFiles(p.repoOwner, p.repoName, p.pullRequestNumber);

    return {
      content: `Found ${files.length} changed files in PR #${p.pullRequestNumber}.`,
      data: {
        files: files.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
        })),
      },
    };
  };
}

// ----------------------------------------------------------------------
// Phase 3 Tools (Outbound Writes)
// ----------------------------------------------------------------------

export interface LinkIssueToTicketParams {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  paperclipIssueId: string;
}

export function makeLinkIssueToTicket(ctx: PluginContext) {
  return async function (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as LinkIssueToTicketParams;

    // Resolve repo_link_id
    const repoLinkRows = await ctx.db.query<{ id: string }>(
      `SELECT id FROM "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       WHERE company_id = $1 AND repo_owner = $2 AND repo_name = $3`,
      [runCtx.companyId, p.repoOwner, p.repoName],
    );

    if (!repoLinkRows.length) {
      return {
        content: `Repository ${p.repoOwner}/${p.repoName} is not linked.`,
        error: "Repository not linked",
      };
    }

    const repoLinkId = repoLinkRows[0].id;

    // Create link
    await ctx.db.execute(
      `INSERT INTO "${PLUGIN_DB_NAMESPACE}".gh_issue_ticket_links
       (repo_link_id, gh_issue_id, paperclip_issue_id, linked_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (repo_link_id, gh_issue_id) DO NOTHING`,
      [repoLinkId, p.issueNumber, p.paperclipIssueId],
    );

    return {
      content: `Linked GitHub issue #${p.issueNumber} to Paperclip ticket ${p.paperclipIssueId}.`,
      data: { issueNumber: p.issueNumber, paperclipIssueId: p.paperclipIssueId },
    };
  };
}

export interface LinkPullRequestToTaskParams {
  repoOwner: string;
  repoName: string;
  pullRequestNumber: number;
  paperclipIssueId: string;
}

export function makeLinkPullRequestToTask(ctx: PluginContext) {
  return async function (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as LinkPullRequestToTaskParams;

    // Resolve repo_link_id
    const repoLinkRows = await ctx.db.query<{ id: string }>(
      `SELECT id FROM "${PLUGIN_DB_NAMESPACE}".gh_repo_links
       WHERE company_id = $1 AND repo_owner = $2 AND repo_name = $3`,
      [runCtx.companyId, p.repoOwner, p.repoName],
    );

    if (!repoLinkRows.length) {
      return {
        content: `Repository ${p.repoOwner}/${p.repoName} is not linked.`,
        error: "Repository not linked",
      };
    }

    const repoLinkId = repoLinkRows[0].id;

    // Create link
    await ctx.db.execute(
      `INSERT INTO "${PLUGIN_DB_NAMESPACE}".gh_pr_task_links
       (repo_link_id, gh_pr_id, paperclip_issue_id, linked_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (repo_link_id, gh_pr_id) DO NOTHING`,
      [repoLinkId, p.pullRequestNumber, p.paperclipIssueId],
    );

    return {
      content: `Linked GitHub PR #${p.pullRequestNumber} to Paperclip task ${p.paperclipIssueId}.`,
      data: { pullRequestNumber: p.pullRequestNumber, paperclipIssueId: p.paperclipIssueId },
    };
  };
}

export interface CreateIssueFromTicketParams {
  repoOwner: string;
  repoName: string;
  title: string;
  body: string;
  labels?: string[];
}

export function makeCreateIssueFromTicket(ctx: PluginContext) {
  return async function (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as CreateIssueFromTicketParams;

    // Resolve config and secrets
    const rawConfig = await ctx.config.get();
    const config = parseConfigOrThrow(rawConfig);

    const privateKey = config.privateKeySecretRef
      ? await ctx.secrets.resolve(config.privateKeySecretRef).catch(() => undefined)
      : undefined;
    const pat = config.patSecretRef
      ? await ctx.secrets.resolve(config.patSecretRef).catch(() => undefined)
      : undefined;
    const webhookSecret = await ctx.secrets.resolve(config.webhookSecretRef).catch(() => undefined);

    const secrets: ResolvedSecrets = {
      privateKey: privateKey ?? undefined,
      webhookSecret: webhookSecret ?? "",
      pat: pat ?? undefined,
    };

    const auth = createAuthProvider(config, secrets, ctx.http.fetch as any);

    const { GitHubClient } = await import("../http/githubClient.js");
    const client = new GitHubClient(auth, ctx.http.fetch as any, ctx.logger);

    // Audit intent
    const auditId = generateAuditId();
    const targetUrl = `https://api.github.com/repos/${p.repoOwner}/${p.repoName}/issues`;
    await recordAuditIntent(ctx, {
      auditId,
      actor: runCtx.agentId,
      tool: "github.createIssueFromTicket",
      targetUrl,
      requestBodyRedacted: JSON.stringify({ title: p.title, body: p.body, labels: p.labels }),
      startedAt: new Date().toISOString(),
    });

    try {
      const issue = await client.createIssue(p.repoOwner, p.repoName, {
        title: p.title,
        body: p.body,
        labels: p.labels,
      });

      // Audit result
      await recordAuditResult(ctx, {
        auditId,
        responseStatus: 201,
        responseEtag: null,
        finishedAt: new Date().toISOString(),
        error: null,
      });

      return {
        content: `Created GitHub issue #${issue.number}: ${issue.title}`,
        data: { issueNumber: issue.number, issueUrl: issue.html_url },
      };
    } catch (error) {
      await recordAuditResult(ctx, {
        auditId,
        responseStatus: 0,
        responseEtag: null,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        content: `Failed to create issue: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

export interface CommentOnIssueParams {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  body: string;
}

export function makeCommentOnIssue(ctx: PluginContext) {
  return async function (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as CommentOnIssueParams;

    // Resolve config and secrets
    const rawConfig = await ctx.config.get();
    const config = parseConfigOrThrow(rawConfig);

    const privateKey = config.privateKeySecretRef
      ? await ctx.secrets.resolve(config.privateKeySecretRef).catch(() => undefined)
      : undefined;
    const pat = config.patSecretRef
      ? await ctx.secrets.resolve(config.patSecretRef).catch(() => undefined)
      : undefined;
    const webhookSecret = await ctx.secrets.resolve(config.webhookSecretRef).catch(() => undefined);

    const secrets: ResolvedSecrets = {
      privateKey: privateKey ?? undefined,
      webhookSecret: webhookSecret ?? "",
      pat: pat ?? undefined,
    };

    const auth = createAuthProvider(config, secrets, ctx.http.fetch as any);

    const { GitHubClient } = await import("../http/githubClient.js");
    const client = new GitHubClient(auth, ctx.http.fetch as any, ctx.logger);

    // Audit intent
    const auditId = generateAuditId();
    const targetUrl = `https://api.github.com/repos/${p.repoOwner}/${p.repoName}/issues/${p.issueNumber}/comments`;
    await recordAuditIntent(ctx, {
      auditId,
      actor: runCtx.agentId,
      tool: "github.commentOnIssue",
      targetUrl,
      requestBodyRedacted: JSON.stringify({ body: p.body }),
      startedAt: new Date().toISOString(),
    });

    try {
      const comment = await client.createIssueComment(p.repoOwner, p.repoName, p.issueNumber, p.body);

      // Audit result
      await recordAuditResult(ctx, {
        auditId,
        responseStatus: 201,
        responseEtag: null,
        finishedAt: new Date().toISOString(),
        error: null,
      });

      return {
        content: `Added comment to issue #${p.issueNumber}`,
        data: { commentId: comment.id, commentUrl: comment.html_url },
      };
    } catch (error) {
      await recordAuditResult(ctx, {
        auditId,
        responseStatus: 0,
        responseEtag: null,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        content: `Failed to add comment: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

export interface CommentOnPullRequestParams {
  repoOwner: string;
  repoName: string;
  pullRequestNumber: number;
  body: string;
}

export function makeCommentOnPullRequest(ctx: PluginContext) {
  return async function (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> {
    const p = params as CommentOnPullRequestParams;

    // Resolve config and secrets
    const rawConfig = await ctx.config.get();
    const config = parseConfigOrThrow(rawConfig);

    const privateKey = config.privateKeySecretRef
      ? await ctx.secrets.resolve(config.privateKeySecretRef).catch(() => undefined)
      : undefined;
    const pat = config.patSecretRef
      ? await ctx.secrets.resolve(config.patSecretRef).catch(() => undefined)
      : undefined;
    const webhookSecret = await ctx.secrets.resolve(config.webhookSecretRef).catch(() => undefined);

    const secrets: ResolvedSecrets = {
      privateKey: privateKey ?? undefined,
      webhookSecret: webhookSecret ?? "",
      pat: pat ?? undefined,
    };

    const auth = createAuthProvider(config, secrets, ctx.http.fetch as any);

    const { GitHubClient } = await import("../http/githubClient.js");
    const client = new GitHubClient(auth, ctx.http.fetch as any, ctx.logger);

    // Audit intent
    const auditId = generateAuditId();
    const targetUrl = `https://api.github.com/repos/${p.repoOwner}/${p.repoName}/pulls/${p.pullRequestNumber}/comments`;
    await recordAuditIntent(ctx, {
      auditId,
      actor: runCtx.agentId,
      tool: "github.commentOnPullRequest",
      targetUrl,
      requestBodyRedacted: JSON.stringify({ body: p.body }),
      startedAt: new Date().toISOString(),
    });

    try {
      const comment = await client.createPullRequestComment(p.repoOwner, p.repoName, p.pullRequestNumber, p.body);

      // Audit result
      await recordAuditResult(ctx, {
        auditId,
        responseStatus: 201,
        responseEtag: null,
        finishedAt: new Date().toISOString(),
        error: null,
      });

      return {
        content: `Added comment to PR #${p.pullRequestNumber}`,
        data: { commentId: comment.id, commentUrl: comment.html_url },
      };
    } catch (error) {
      await recordAuditResult(ctx, {
        auditId,
        responseStatus: 0,
        responseEtag: null,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        content: `Failed to add comment: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
