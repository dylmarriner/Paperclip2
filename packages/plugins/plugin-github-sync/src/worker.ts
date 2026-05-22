/**
 * Plugin worker entrypoint for @paperclipai/plugin-github-sync.
 *
 * Commit C (current) wires:
 *   - Config resolution and validation
 *   - Secret resolution and auth provider creation
 *   - 3 plugin tools: connectRepository, disconnectRepository, listRepositories
 *   - Webhook ingress with signature verification, dedup, and 5 event handlers
 *   - Health diagnostics reporting what is active
 */
import { definePlugin } from "@paperclipai/plugin-sdk";
import { PLUGIN_ID, PLUGIN_VERSION, PLUGIN_DB_NAMESPACE } from "./constants.js";
import { validateConfig, parseConfigOrThrow } from "./config/validate.js";
import type { GitHubSyncConfig } from "./config/schema.js";
import { createAuthProvider, type ResolvedSecrets } from "./auth/index.js";
import {
  makeConnectRepository,
  makeDisconnectRepository,
  makeListRepositories,
  makeSyncRepository,
  makeReconcileRepository,
  makeListIssues,
  makeListPullRequests,
  makeGetWorkflowStatus,
  makeGetRecentCommits,
  makeGetChangedFilesForPullRequest,
  makeLinkIssueToTicket,
  makeLinkPullRequestToTask,
  makeCreateIssueFromTicket,
  makeCommentOnIssue,
  makeCommentOnPullRequest,
} from "./tools/index.js";
import { dispatchWebhook, type WebhookDispatchInput } from "./webhooks/dispatcher.js";
import { GitHubSyncError } from "./errors.js";

let pluginCtx: import("@paperclipai/plugin-sdk").PluginContext | null = null;
let currentConfig: GitHubSyncConfig | null = null;
let currentSecrets: ResolvedSecrets | null = null;

export default definePlugin({
  async setup(ctx) {
    pluginCtx = ctx;
    const rawConfig = await ctx.config.get();
    const config = parseConfigOrThrow(rawConfig);
    currentConfig = config;

    // Resolve secrets once at startup.
    const privateKey = config.privateKeySecretRef
      ? await ctx.secrets.resolve(config.privateKeySecretRef).catch(() => undefined)
      : undefined;
    const pat = config.patSecretRef
      ? await ctx.secrets.resolve(config.patSecretRef).catch(() => undefined)
      : undefined;
    const webhookSecret = await ctx.secrets.resolve(config.webhookSecretRef).catch(() => undefined);

    if (!webhookSecret) {
      ctx.logger.warn("Webhook secret not resolved; webhook signature verification will fail");
    }

    currentSecrets = {
      privateKey: privateKey ?? undefined,
      webhookSecret: webhookSecret ?? "",
      pat: pat ?? undefined,
    };

    // Create auth provider (used by future sync jobs and outbound writes).
    createAuthProvider(config, currentSecrets, ctx.http.fetch);

    ctx.logger.info("GitHub Sync plugin worker started", {
      pluginId: PLUGIN_ID,
      version: PLUGIN_VERSION,
      phase: "commit-c",
      syncMode: config.syncMode,
    });

    // Register tools
    ctx.tools.register(
      "connectRepository",
      {
        displayName: "Connect GitHub Repository",
        description: "Link a GitHub repository to the current Paperclip company.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string", description: "GitHub repository owner (user or org)" },
            repoName: { type: "string", description: "GitHub repository name" },
          },
          required: ["repoOwner", "repoName"],
        },
      },
      makeConnectRepository(ctx),
    );

    ctx.tools.register(
      "disconnectRepository",
      {
        displayName: "Disconnect GitHub Repository",
        description: "Unlink a GitHub repository from the current Paperclip company.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
          },
          required: ["repoOwner", "repoName"],
        },
      },
      makeDisconnectRepository(ctx),
    );

    ctx.tools.register(
      "listRepositories",
      {
        displayName: "List Connected Repositories",
        description: "List all GitHub repositories linked to the current company.",
        parametersSchema: { type: "object", properties: {} },
      },
      makeListRepositories(ctx),
    );

    // Phase 2 tools
    ctx.tools.register(
      "syncRepository",
      {
        displayName: "Sync Repository",
        description: "Trigger initial import for a linked GitHub repository.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
          },
          required: ["repoOwner", "repoName"],
        },
      },
      makeSyncRepository(ctx),
    );

    ctx.tools.register(
      "reconcileRepository",
      {
        displayName: "Reconcile Repository",
        description: "Trigger reconciliation for a linked GitHub repository.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
          },
          required: ["repoOwner", "repoName"],
        },
      },
      makeReconcileRepository(ctx),
    );

    ctx.tools.register(
      "listIssues",
      {
        displayName: "List Issues",
        description: "List issues from a GitHub repository.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
            state: { type: "string", enum: ["open", "closed", "all"] },
          },
          required: ["repoOwner", "repoName"],
        },
      },
      makeListIssues(ctx),
    );

    ctx.tools.register(
      "listPullRequests",
      {
        displayName: "List Pull Requests",
        description: "List pull requests from a GitHub repository.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
            state: { type: "string", enum: ["open", "closed", "all"] },
          },
          required: ["repoOwner", "repoName"],
        },
      },
      makeListPullRequests(ctx),
    );

    ctx.tools.register(
      "getWorkflowStatus",
      {
        displayName: "Get Workflow Status",
        description: "Get CI workflow status for a GitHub repository.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
            branch: { type: "string" },
          },
          required: ["repoOwner", "repoName"],
        },
      },
      makeGetWorkflowStatus(ctx),
    );

    ctx.tools.register(
      "getRecentCommits",
      {
        displayName: "Get Recent Commits",
        description: "Get recent commits from a GitHub repository.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
            branch: { type: "string" },
            limit: { type: "number" },
          },
          required: ["repoOwner", "repoName"],
        },
      },
      makeGetRecentCommits(ctx),
    );

    ctx.tools.register(
      "getChangedFilesForPullRequest",
      {
        displayName: "Get Changed Files for Pull Request",
        description: "Get changed files for a specific pull request.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
            pullRequestNumber: { type: "number" },
          },
          required: ["repoOwner", "repoName", "pullRequestNumber"],
        },
      },
      makeGetChangedFilesForPullRequest(ctx),
    );

    // Phase 3 tools
    ctx.tools.register(
      "linkIssueToTicket",
      {
        displayName: "Link Issue to Ticket",
        description: "Link a GitHub issue to a Paperclip ticket.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
            issueNumber: { type: "number" },
            paperclipIssueId: { type: "string" },
          },
          required: ["repoOwner", "repoName", "issueNumber", "paperclipIssueId"],
        },
      },
      makeLinkIssueToTicket(ctx),
    );

    ctx.tools.register(
      "linkPullRequestToTask",
      {
        displayName: "Link Pull Request to Task",
        description: "Link a GitHub pull request to a Paperclip task.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
            pullRequestNumber: { type: "number" },
            paperclipIssueId: { type: "string" },
          },
          required: ["repoOwner", "repoName", "pullRequestNumber", "paperclipIssueId"],
        },
      },
      makeLinkPullRequestToTask(ctx),
    );

    ctx.tools.register(
      "createIssueFromTicket",
      {
        displayName: "Create Issue from Ticket",
        description: "Create a GitHub issue from a Paperclip ticket.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            labels: { type: "array", items: { type: "string" } },
          },
          required: ["repoOwner", "repoName", "title", "body"],
        },
      },
      makeCreateIssueFromTicket(ctx),
    );

    ctx.tools.register(
      "commentOnIssue",
      {
        displayName: "Comment on Issue",
        description: "Add a comment to a GitHub issue.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
            issueNumber: { type: "number" },
            body: { type: "string" },
          },
          required: ["repoOwner", "repoName", "issueNumber", "body"],
        },
      },
      makeCommentOnIssue(ctx),
    );

    ctx.tools.register(
      "commentOnPullRequest",
      {
        displayName: "Comment on Pull Request",
        description: "Add a comment to a GitHub pull request.",
        parametersSchema: {
          type: "object",
          properties: {
            repoOwner: { type: "string" },
            repoName: { type: "string" },
            pullRequestNumber: { type: "number" },
            body: { type: "string" },
          },
          required: ["repoOwner", "repoName", "pullRequestNumber", "body"],
        },
      },
      makeCommentOnPullRequest(ctx),
    );
  },

  async onWebhook(input) {
    if (!pluginCtx || !currentSecrets) {
      throw new GitHubSyncError("Worker not initialized", "WORKER_NOT_READY", true);
    }

    // Extract repo info from webhook payload when available.
    const payload = input.parsedBody as { repository?: { owner?: { login?: string }; name?: string } } | undefined;
    const repoOwner = payload?.repository?.owner?.login ?? "unknown";
    const repoName = payload?.repository?.name ?? "unknown";

    const cfg = {
      companyId: "default",
      repoOwner,
      repoName,
      webhookSecret: currentSecrets.webhookSecret,
    };

    await dispatchWebhook(
      pluginCtx,
      input as unknown as WebhookDispatchInput,
      cfg,
    );
  },

  async onHealth() {
    return {
      status: "ok",
      message:
        "GitHub Sync plugin (Commit C): config validation, webhook handlers, and tools are live.",
      details: {
        version: PLUGIN_VERSION,
        phase: "commit-c",
        webhookHandlerWired: true,
        toolsWired: true,
      },
    };
  },

  async onValidateConfig(config) {
    return validateConfig(config);
  },
});
