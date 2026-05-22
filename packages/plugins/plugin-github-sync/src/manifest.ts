/**
 * Paperclip plugin manifest for the GitHub Sync plugin.
 *
 * Loaded by the plugin host at install/enable time. The host reads:
 *   - `id` / `version`               → plugin registry key + version pin
 *   - `capabilities`                 → required-permission gate
 *   - `entrypoints.worker`           → built worker bundle
 *   - `instanceConfigSchema`         → rendered into the settings UI
 *   - `webhooks[]`                   → enables POST ingress route
 *   - `tools[]`                      → registers callable plugin tools
 *   - `database.namespaceSlug`       → derives plugin Postgres schema
 *   - `database.migrationsDir`       → SQL migration directory
 *   - `database.coreReadTables`      → public.* tables the plugin may read
 *
 * Phase 1 ships:
 *   - webhook ingress (handler logic delivered in Commit C)
 *   - 3 plugin tools (connect/disconnect/list — handlers in Commit C)
 *   - the full instance config schema (Commit A)
 *   - the initial DB schema (Commit A)
 *
 * Phase 2 adds: jobs (reconciliation), 7 more tools, full event coverage.
 * Phase 3 adds: 6 more tools, UI slots (project + ticket panels, settings page).
 */
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DATABASE_NAMESPACE_SLUG,
  PLUGIN_ID,
  PLUGIN_VERSION,
  TOOL_NAMES,
  WEBHOOK_KEYS,
} from "./constants.js";
import { instanceConfigJsonSchema } from "./config/schema.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "GitHub Sync",
  description:
    "Syncs GitHub repositories, issues, pull requests, commits, branches, labels, workflow/check statuses, and review activity into the PaperclipAI control plane. GitHub remains the source of truth for code state; Paperclip remains the authority over tickets, governance, and budgets.",
  author: "Paperclip",
  categories: ["connector", "automation"],
  capabilities: [
    // Operator wiring
    "projects.read",
    "companies.read",
    // Webhook ingress is required for inbound GitHub events.
    "webhooks.receive",
    // Outbound REST calls to GitHub.
    "http.outbound",
    // Resolve the App private key, webhook secret, and PAT references.
    "secrets.read-ref",
    // Per-repo sync cursors and installation-token cache.
    "plugin.state.read",
    "plugin.state.write",
    // Audit trail for every accepted webhook and every outbound write.
    "activity.log.write",
    // Phase 1 tools register through the agent tool surface.
    "agent.tools.register",
    // Phase 1 reads issues to support link tools (Phase 3 adds writes).
    "issues.read",
    // Emit cross-plugin events (e.g. `plugin.github.sync.completed`).
    "events.emit",
    // Phase 3 UI capabilities
    "ui.detailTab.register",
    "ui.page.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    // UI bundle ships in Phase 3; declared here for forward-compat so the
    // host can serve static assets from this directory once they exist.
    ui: "./dist/ui",
  },
  instanceConfigSchema: instanceConfigJsonSchema,
  webhooks: [
    {
      endpointKey: WEBHOOK_KEYS.github,
      displayName: "GitHub Webhook",
      description:
        "Inbound GitHub webhook events. Configure this URL as the webhook target on the GitHub App and use the configured webhook secret for X-Hub-Signature-256 signing.",
    },
  ],
  tools: [
    {
      name: TOOL_NAMES.connectRepository,
      displayName: "GitHub: Connect Repository",
      description:
        "Bind a GitHub repository to a Paperclip project. Discovers installation metadata, persists the link, and primes the sync state. Fails if the repo is already linked to a different project.",
      parametersSchema: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description: "Paperclip project UUID to bind the repo to.",
          },
          owner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repo: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
        },
        required: ["projectId", "owner", "repo"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.disconnectRepository,
      displayName: "GitHub: Disconnect Repository",
      description:
        "Remove a repository link. Soft-deletes the link row; mirror tables are retained for historical reference until the next vacuum.",
      parametersSchema: {
        type: "object",
        properties: {
          repoLinkId: {
            type: "string",
            description: "UUID of the `gh_repo_links` row to disconnect.",
          },
        },
        required: ["repoLinkId"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.listRepositories,
      displayName: "GitHub: List Connected Repositories",
      description:
        "Return all repositories currently linked for the calling company. Read-only, no outbound HTTP.",
      parametersSchema: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description:
              "Optional project filter. When omitted, returns repos across all projects in the company.",
          },
        },
        additionalProperties: false,
      },
    },
    // Phase 2 tools
    {
      name: TOOL_NAMES.syncRepository,
      displayName: "GitHub: Sync Repository",
      description:
        "Trigger initial import for a linked GitHub repository. Fetches repo metadata, issues, PRs, branches, commits, and CI state.",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
        },
        required: ["repoOwner", "repoName"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.reconcileRepository,
      displayName: "GitHub: Reconcile Repository",
      description:
        "Trigger reconciliation for a linked GitHub repository. Refreshes data since last sync with a 24h overlap window.",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
        },
        required: ["repoOwner", "repoName"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.listIssues,
      displayName: "GitHub: List Issues",
      description:
        "List issues from a GitHub repository. Supports filtering by state (open/closed/all).",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
          state: {
            type: "string",
            enum: ["open", "closed", "all"],
            description: "Issue state filter.",
          },
        },
        required: ["repoOwner", "repoName"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.listPullRequests,
      displayName: "GitHub: List Pull Requests",
      description:
        "List pull requests from a GitHub repository. Supports filtering by state (open/closed/all).",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
          state: {
            type: "string",
            enum: ["open", "closed", "all"],
            description: "PR state filter.",
          },
        },
        required: ["repoOwner", "repoName"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.getWorkflowStatus,
      displayName: "GitHub: Get Workflow Status",
      description:
        "Get CI workflow status for a GitHub repository. Returns recent workflow runs.",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
          branch: {
            type: "string",
            description: "Optional branch filter.",
          },
        },
        required: ["repoOwner", "repoName"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.getRecentCommits,
      displayName: "GitHub: Get Recent Commits",
      description:
        "Get recent commits from a GitHub repository. Supports branch filter and limit.",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
          branch: {
            type: "string",
            description: "Optional branch filter.",
          },
          limit: {
            type: "number",
            description: "Maximum number of commits to return (default 20).",
          },
        },
        required: ["repoOwner", "repoName"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.getChangedFilesForPullRequest,
      displayName: "GitHub: Get Changed Files for Pull Request",
      description:
        "Get changed files for a specific pull request. Returns file list with status and line counts.",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
          pullRequestNumber: {
            type: "number",
            description: "Pull request number.",
          },
        },
        required: ["repoOwner", "repoName", "pullRequestNumber"],
        additionalProperties: false,
      },
    },
    // Phase 3 tools
    {
      name: TOOL_NAMES.linkIssueToTicket,
      displayName: "GitHub: Link Issue to Ticket",
      description:
        "Link a GitHub issue to a Paperclip ticket. Creates a bidirectional link in the plugin's link tables.",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
          issueNumber: {
            type: "number",
            description: "GitHub issue number.",
          },
          paperclipIssueId: {
            type: "string",
            description: "Paperclip ticket UUID.",
          },
        },
        required: ["repoOwner", "repoName", "issueNumber", "paperclipIssueId"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.linkPullRequestToTask,
      displayName: "GitHub: Link Pull Request to Task",
      description:
        "Link a GitHub pull request to a Paperclip task. Creates a bidirectional link in the plugin's link tables.",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
          pullRequestNumber: {
            type: "number",
            description: "GitHub pull request number.",
          },
          paperclipIssueId: {
            type: "string",
            description: "Paperclip task UUID.",
          },
        },
        required: ["repoOwner", "repoName", "pullRequestNumber", "paperclipIssueId"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.createIssueFromTicket,
      displayName: "GitHub: Create Issue from Ticket",
      description:
        "Create a GitHub issue from a Paperclip ticket. Audited outbound write with intent/result logging.",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
          title: {
            type: "string",
            description: "Issue title.",
          },
          body: {
            type: "string",
            description: "Issue body (markdown).",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Optional labels to apply.",
          },
        },
        required: ["repoOwner", "repoName", "title", "body"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.commentOnIssue,
      displayName: "GitHub: Comment on Issue",
      description:
        "Add a comment to a GitHub issue. Audited outbound write with intent/result logging.",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
          issueNumber: {
            type: "number",
            description: "GitHub issue number.",
          },
          body: {
            type: "string",
            description: "Comment body (markdown).",
          },
        },
        required: ["repoOwner", "repoName", "issueNumber", "body"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.commentOnPullRequest,
      displayName: "GitHub: Comment on Pull Request",
      description:
        "Add a comment to a GitHub pull request. Audited outbound write with intent/result logging.",
      parametersSchema: {
        type: "object",
        properties: {
          repoOwner: {
            type: "string",
            description: "GitHub repo owner (org or user login).",
          },
          repoName: {
            type: "string",
            description: "GitHub repo name (without the owner prefix).",
          },
          pullRequestNumber: {
            type: "number",
            description: "GitHub pull request number.",
          },
          body: {
            type: "string",
            description: "Comment body (markdown).",
          },
        },
        required: ["repoOwner", "repoName", "pullRequestNumber", "body"],
        additionalProperties: false,
      },
    },
  ],
  ui: {
    slots: [
      {
        type: "detailTab",
        id: "github-project-panel",
        displayName: "GitHub Sync",
        entityTypes: ["project"],
        exportName: "ProjectPanel",
      },
      {
        type: "detailTab",
        id: "github-issue-panel",
        displayName: "GitHub Sync",
        entityTypes: ["issue"],
        exportName: "IssuePanel",
      },
      {
        type: "page",
        id: "github-settings",
        displayName: "GitHub Sync Settings",
        exportName: "SettingsPage",
      },
    ],
  },
  database: {
    namespaceSlug: DATABASE_NAMESPACE_SLUG,
    migrationsDir: "migrations",
    coreReadTables: ["companies", "projects", "issues"],
  },
};

export default manifest;
