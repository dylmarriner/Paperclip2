/**
 * Stable identifiers and key strings used across the GitHub Sync plugin.
 *
 * Centralizing these here lets the manifest, worker, tools, tests, and the
 * deferred UI bundle all reference the same canonical constants without
 * importing the manifest module (which would pull in JSON Schemas the
 * runtime worker does not need).
 *
 * Anything in this file is part of the plugin's public contract. Changing
 * a key here is a breaking change for already-installed instances because
 * the host stores plugin state keyed on (plugin_id, scope, state_key).
 */

/** Manifest `id`. Stable for the lifetime of the plugin. */
export const PLUGIN_ID = "paperclip-plugin-github-sync";

/** Manifest `version` — bump in lockstep with `package.json`. */
export const PLUGIN_VERSION = "0.1.0";

/**
 * Slug passed as `manifest.database.namespaceSlug`.
 *
 * Combined with sha256(PLUGIN_ID).slice(0,10) by the host the resulting
 * Postgres schema name is `plugin_github_sync_60491d4d6b`. The hash is
 * hard-coded into the migration SQL — if you change PLUGIN_ID you MUST
 * recompute the hash and rewrite the migrations.
 */
export const DATABASE_NAMESPACE_SLUG = "github_sync";

/**
 * Webhook endpoint key declared in `manifest.webhooks[]`.
 *
 * The host exposes this at `POST /api/plugins/<plugin-id>/webhooks/github`.
 * GitHub's webhook delivery target should be set to that URL.
 */
export const WEBHOOK_KEYS = {
  github: "github",
} as const;

/**
 * Names of plugin tools that agents and operators can invoke.
 *
 * Phase 1 ships only the connect/disconnect/list trio. The remaining
 * tools land in Phase 2 (read-only sync ops) and Phase 3 (outbound
 * writes + linking).
 */
export const TOOL_NAMES = {
  connectRepository: "github.connectRepository",
  disconnectRepository: "github.disconnectRepository",
  listRepositories: "github.listRepositories",
  // Phase 2 tools
  syncRepository: "github.syncRepository",
  reconcileRepository: "github.reconcileRepository",
  listIssues: "github.listIssues",
  listPullRequests: "github.listPullRequests",
  getWorkflowStatus: "github.getWorkflowStatus",
  getRecentCommits: "github.getRecentCommits",
  getChangedFilesForPullRequest: "github.getChangedFilesForPullRequest",
  // Phase 3 tools
  linkIssueToTicket: "github.linkIssueToTicket",
  linkPullRequestToTask: "github.linkPullRequestToTask",
  createIssueFromTicket: "github.createIssueFromTicket",
  commentOnIssue: "github.commentOnIssue",
  commentOnPullRequest: "github.commentOnPullRequest",
} as const;

/** Default branch glob list for `protected_branches`. */
export const DEFAULT_PROTECTED_BRANCHES = ["main", "master", "release/*"] as const;

/**
 * Sync mode literal values. `prod` requires GitHub App credentials.
 * `dev` permits a PAT for local development only.
 */
export const SYNC_MODES = ["prod", "dev"] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

/**
 * Stable state-store keys used with `ctx.state`. Namespaced under the
 * default namespace; nested scopes (per-repo) extend with the repo
 * link UUID.
 */
export const STATE_KEYS = {
  /** Cached installation tokens, keyed by installation id. */
  installationTokens: "auth.installation-tokens",
  /** Last reconciliation cursor per repo link. */
  reconcileCursor: "sync.reconcile-cursor",
} as const;

/** Activity-log entry kinds emitted by this plugin. */
export const ACTIVITY_KINDS = {
  webhookReceived: "github.webhook.received",
  webhookDuplicate: "github.webhook.duplicate",
  webhookSignatureRejected: "github.webhook.signature-rejected",
  webhookFailed: "github.webhook.failed",
  repoConnected: "github.repo.connected",
  repoDisconnected: "github.repo.disconnected",
  syncStarted: "github.sync.started",
  syncCompleted: "github.sync.completed",
  syncFailed: "github.sync.failed",
  commit: "github.commit",
  verification: "github.verification",
  verificationFailed: "github.verification.failed",
  outboundWriteIntent: "github.outbound.intent",
  outboundWriteResult: "github.outbound.result",
} as const;

/** Header names the plugin reads from inbound webhook requests. */
export const GITHUB_HEADERS = {
  event: "x-github-event",
  delivery: "x-github-delivery",
  signature256: "x-hub-signature-256",
  userAgent: "user-agent",
} as const;

/** GitHub API base URL for github.com (Phase 1 only supports public GitHub). */
export const GITHUB_API_BASE_URL = "https://api.github.com";

/** Fixed User-Agent used on all outbound requests for traceability. */
export const OUTBOUND_USER_AGENT = `paperclip-plugin-github-sync/${PLUGIN_VERSION}`;

/**
 * GitHub recommends pinning to a versioned API. This value is sent as the
 * `X-GitHub-Api-Version` header on every REST request.
 */
export const GITHUB_API_VERSION = "2022-11-28";

/** Deterministic Postgres schema name for this plugin's tables. */
export const PLUGIN_DB_NAMESPACE = "plugin_github_sync_60491d4d6b";
