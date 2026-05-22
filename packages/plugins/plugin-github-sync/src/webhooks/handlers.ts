/**
 * GitHub webhook event handlers.
 *
 * Each handler receives the parsed webhook payload and the plugin context.
 * Handlers are responsible for updating the plugin mirror tables. They do
 * NOT write to Paperclip core tables directly unless `allowAuthoritativeWrites`
 * is enabled (future Phase 3 feature).
 *
 * Handlers should be idempotent where possible. Upsert patterns are preferred
 * over insert-then-update.
 *
 * Event types covered (Commit C):
 *   - push: branch ref updates (triggers commit sync)
 *   - issues: opened, edited, closed, reopened, labeled, unlabeled
 *   - pull_request: opened, edited, closed, reopened, labeled, unlabeled, synchronize
 *   - workflow_run: queued, in_progress, completed
 *   - check_run: created, completed
 *
 * Handlers return void on success and throw on unrecoverable errors.
 * The dispatcher decides whether to retry based on the error type.
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { WebhookPayloadError } from "../errors.js";
import { PLUGIN_DB_NAMESPACE } from "../constants.js";

export interface HandlerContext {
  ctx: PluginContext;
  companyId: string;
  repoOwner: string;
  repoName: string;
  eventType: string;
  action?: string;
}

/** Resolve the repo_link_id for a given owner/name. Throws if not found. */
async function resolveRepoLinkId(
  ctx: PluginContext,
  repoOwner: string,
  repoName: string,
): Promise<string> {
  const rows = await ctx.db.query<{ id: string }>(
    `SELECT id FROM "${PLUGIN_DB_NAMESPACE}".gh_repo_links
     WHERE repo_owner = $1 AND repo_name = $2
     LIMIT 1`,
    [repoOwner, repoName],
  );
  if (!rows.length) {
    throw new WebhookPayloadError(
      `No repo link found for ${repoOwner}/${repoName}`,
    );
  }
  return rows[0].id;
}

// -----------------------------------------------------------------------
// push
// -----------------------------------------------------------------------

export async function handlePush(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    ref?: string;
    after?: string;
    repository?: { full_name?: string };
  };
  if (!p.ref || !p.after) {
    throw new WebhookPayloadError("push event missing ref or after");
  }

  const branch = p.ref.replace("refs/heads/", "");

  // Upsert the repo link record's last_push_at
  await hCtx.ctx.db.execute(
    `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_repo_links
     SET last_push_at = NOW()
     WHERE repo_owner = $1 AND repo_name = $2`,
    [hCtx.repoOwner, hCtx.repoName],
  );

  // Phase 3: trigger commit/branch sync job here
}

// -----------------------------------------------------------------------
// issues
// -----------------------------------------------------------------------

export async function handleIssue(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    issue?: {
      id: number;
      node_id: string;
      number: number;
      title: string;
      body: string | null;
      state: string;
      state_reason: string | null;
      labels: Array<{ name: string; color?: string }>;
      user: { login: string; id: number } | null;
      created_at: string;
      updated_at: string;
      closed_at: string | null;
    };
    repository?: { full_name?: string };
  };

  if (!p.issue) {
    throw new WebhookPayloadError("issues event missing issue object");
  }

  const issue = p.issue;
  const labels = issue.labels.map((l) => l.name);
  const repoLinkId = await resolveRepoLinkId(hCtx.ctx, hCtx.repoOwner, hCtx.repoName);

  await hCtx.ctx.db.execute(
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
      `https://github.com/${hCtx.repoOwner}/${hCtx.repoName}/issues/${issue.number}`,
      issue.created_at,
      issue.updated_at,
      issue.closed_at,
      JSON.stringify(payload),
    ],
  );
}

// -----------------------------------------------------------------------
// pull_request
// -----------------------------------------------------------------------

export async function handlePullRequest(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    pull_request?: {
      id: number;
      node_id: string;
      number: number;
      title: string;
      body: string | null;
      state: string;
      draft: boolean;
      merged: boolean;
      merge_commit_sha: string | null;
      head: { ref: string; sha: string };
      base: { ref: string; sha: string };
      user: { login: string; id: number } | null;
      labels: Array<{ name: string }>;
      html_url: string;
      created_at: string;
      updated_at: string;
      closed_at: string | null;
      merged_at: string | null;
    };
  };

  if (!p.pull_request) {
    throw new WebhookPayloadError("pull_request event missing pull_request object");
  }

  const pr = p.pull_request;
  const labels = pr.labels.map((l) => l.name);
  const repoLinkId = await resolveRepoLinkId(hCtx.ctx, hCtx.repoOwner, hCtx.repoName);

  await hCtx.ctx.db.execute(
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
      JSON.stringify(payload),
    ],
  );
}

// -----------------------------------------------------------------------
// workflow_run
// -----------------------------------------------------------------------

export async function handleWorkflowRun(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    workflow_run?: {
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      head_branch: string;
      head_sha: string;
      html_url: string;
      created_at: string;
      updated_at: string;
    };
  };

  if (!p.workflow_run) {
    throw new WebhookPayloadError("workflow_run event missing workflow_run object");
  }

  // For Commit C we store workflow state in the repo link's raw JSONB.
  // Phase 3 will add a dedicated workflow_runs table.
  const run = p.workflow_run;
  const record = {
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    head_branch: run.head_branch,
    head_sha: run.head_sha,
    html_url: run.html_url,
    updated_at: run.updated_at,
  };

  await hCtx.ctx.db.execute(
    `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_repo_links
     SET raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('last_workflow_run', $1::jsonb),
         updated_at = NOW()
     WHERE repo_owner = $2 AND repo_name = $3`,
    [JSON.stringify(record), hCtx.repoOwner, hCtx.repoName],
  );
}

// -----------------------------------------------------------------------
// check_run
// -----------------------------------------------------------------------

export async function handleCheckRun(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    check_run?: {
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      html_url: string;
    };
  };

  if (!p.check_run) {
    throw new WebhookPayloadError("check_run event missing check_run object");
  }

  // Store in repo link raw JSONB for now.
  const check = p.check_run;
  const record = {
    id: check.id,
    name: check.name,
    status: check.status,
    conclusion: check.conclusion,
    html_url: check.html_url,
  };

  await hCtx.ctx.db.execute(
    `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_repo_links
     SET raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('last_check_run', $1::jsonb),
         updated_at = NOW()
     WHERE repo_owner = $2 AND repo_name = $3`,
    [JSON.stringify(record), hCtx.repoOwner, hCtx.repoName],
  );
}

// -----------------------------------------------------------------------
// pull_request_review
// -----------------------------------------------------------------------

export async function handlePullRequestReview(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    review?: {
      id: number;
      user: { login: string };
      body: string | null;
      state: string;
      html_url: string;
      submitted_at: string;
    };
    pull_request?: { number: number };
  };
  if (!p.review) {
    throw new WebhookPayloadError("pull_request_review event missing review");
  }
  const repoLinkId = await resolveRepoLinkId(hCtx.ctx, hCtx.repoOwner, hCtx.repoName);
  await hCtx.ctx.db.execute(
    `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_pr_mirrors
     SET raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{last_review}',
       jsonb_build_object('id', $1, 'state', $2, 'submitted_at', $3, 'author', $4)),
         last_seen_at = now()
     WHERE repo_link_id = $5 AND gh_number = $6`,
    [p.review.id, p.review.state, p.review.submitted_at, p.review.user.login, repoLinkId, p.pull_request?.number ?? 0],
  );
}

// -----------------------------------------------------------------------
// pull_request_review_comment
// -----------------------------------------------------------------------

export async function handlePullRequestReviewComment(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    comment?: {
      id: number;
      user: { login: string };
      body: string;
      html_url: string;
      created_at: string;
    };
    pull_request?: { number: number };
  };
  if (!p.comment) {
    throw new WebhookPayloadError("pull_request_review_comment event missing comment");
  }
  const repoLinkId = await resolveRepoLinkId(hCtx.ctx, hCtx.repoOwner, hCtx.repoName);
  await hCtx.ctx.db.execute(
    `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_pr_mirrors
     SET raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{last_review_comment}',
       jsonb_build_object('id', $1, 'body_hash', md5($2), 'created_at', $3, 'author', $4)),
         last_seen_at = now()
     WHERE repo_link_id = $5 AND gh_number = $6`,
    [p.comment.id, p.comment.body, p.comment.created_at, p.comment.user.login, repoLinkId, p.pull_request?.number ?? 0],
  );
}

// -----------------------------------------------------------------------
// issue_comment
// -----------------------------------------------------------------------

export async function handleIssueComment(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    comment?: {
      id: number;
      user: { login: string };
      body: string;
      created_at: string;
    };
    issue?: { number: number };
  };
  if (!p.comment) {
    throw new WebhookPayloadError("issue_comment event missing comment");
  }
  const repoLinkId = await resolveRepoLinkId(hCtx.ctx, hCtx.repoOwner, hCtx.repoName);
  await hCtx.ctx.db.execute(
    `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_issue_mirrors
     SET raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{last_comment}',
       jsonb_build_object('id', $1, 'body_hash', md5($2), 'created_at', $3, 'author', $4)),
         last_seen_at = now()
     WHERE repo_link_id = $5 AND gh_number = $6`,
    [p.comment.id, p.comment.body, p.comment.created_at, p.comment.user.login, repoLinkId, p.issue?.number ?? 0],
  );
}

// -----------------------------------------------------------------------
// check_suite
// -----------------------------------------------------------------------

export async function handleCheckSuite(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    check_suite?: {
      id: number;
      status: string;
      conclusion: string | null;
      head_sha: string;
      head_branch: string;
      html_url: string;
    };
  };
  if (!p.check_suite) {
    throw new WebhookPayloadError("check_suite event missing check_suite");
  }
  const suite = p.check_suite;
  const repoLinkId = await resolveRepoLinkId(hCtx.ctx, hCtx.repoOwner, hCtx.repoName);
  await hCtx.ctx.db.execute(
    `INSERT INTO "${PLUGIN_DB_NAMESPACE}".gh_check_mirrors
     (repo_link_id, kind, external_id, name, head_sha, head_branch, status, conclusion, details_url, raw)
     VALUES ($1, 'check_suite', $2, 'suite', $3, $4, $5, $6, $7, $8)
     ON CONFLICT (repo_link_id, kind, external_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       conclusion = EXCLUDED.conclusion,
       raw = EXCLUDED.raw,
       last_seen_at = now()`,
    [repoLinkId, suite.id, suite.head_sha, suite.head_branch, suite.status, suite.conclusion, suite.html_url, JSON.stringify(payload)],
  );
}

// -----------------------------------------------------------------------
// create (branch or tag)
// -----------------------------------------------------------------------

export async function handleCreate(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    ref?: string;
    ref_type?: string;
  };
  if (!p.ref || !p.ref_type) {
    throw new WebhookPayloadError("create event missing ref or ref_type");
  }
  if (p.ref_type !== "branch") {
    return; // Only track branches in v1
  }
  const repoLinkId = await resolveRepoLinkId(hCtx.ctx, hCtx.repoOwner, hCtx.repoName);
  await hCtx.ctx.db.execute(
    `INSERT INTO "${PLUGIN_DB_NAMESPACE}".gh_branch_mirrors
     (repo_link_id, ref, head_sha, protected, deleted_at)
     VALUES ($1, $2, '', false, null)
     ON CONFLICT (repo_link_id, ref)
     DO UPDATE SET
       deleted_at = null,
       last_seen_at = now()`,
    [repoLinkId, p.ref],
  );
}

// -----------------------------------------------------------------------
// delete (branch or tag)
// -----------------------------------------------------------------------

export async function handleDelete(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    ref?: string;
    ref_type?: string;
  };
  if (!p.ref || !p.ref_type) {
    throw new WebhookPayloadError("delete event missing ref or ref_type");
  }
  if (p.ref_type !== "branch") {
    return;
  }
  const repoLinkId = await resolveRepoLinkId(hCtx.ctx, hCtx.repoOwner, hCtx.repoName);
  await hCtx.ctx.db.execute(
    `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_branch_mirrors
     SET deleted_at = now(), last_seen_at = now()
     WHERE repo_link_id = $1 AND ref = $2`,
    [repoLinkId, p.ref],
  );
}

// -----------------------------------------------------------------------
// repository (archived, unarchived, renamed, transferred, etc.)
// -----------------------------------------------------------------------

export async function handleRepository(
  payload: unknown,
  hCtx: HandlerContext,
): Promise<void> {
  const p = payload as {
    action?: string;
    repository?: {
      full_name?: string;
      html_url?: string;
      archived?: boolean;
    };
  };
  if (!p.repository) {
    throw new WebhookPayloadError("repository event missing repository");
  }
  const action = p.action ?? "unknown";
  await hCtx.ctx.db.execute(
    `UPDATE "${PLUGIN_DB_NAMESPACE}".gh_repo_links
     SET status = CASE
           WHEN $1 = 'archived' THEN 'archived'
           WHEN $1 = 'unarchived' THEN 'active'
           ELSE status
         END,
         html_url = COALESCE($2, html_url),
         updated_at = now()
     WHERE repo_owner = $3 AND repo_name = $4`,
    [action, p.repository.html_url ?? null, hCtx.repoOwner, hCtx.repoName],
  );
}
