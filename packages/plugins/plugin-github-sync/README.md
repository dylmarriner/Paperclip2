# @paperclipai/plugin-github-sync

GitHub control-plane sync for PaperclipAI. Syncs GitHub repositories, issues,
pull requests, commits, branches, labels, workflow/check statuses, and review
activity into the Paperclip control plane.

**Design intent:** project-intelligence sync layer, not a GitHub coding bot.
Coding agents continue to work through the existing adapters (OpenCode, Kiro,
Windsurf, OpenClaw, Claude, etc.). This plugin gives Paperclip's control plane
the real repo state so it stops guessing.

GitHub remains the source of truth for code state. Paperclip remains the
authority over tickets, governance, and budgets. The plugin never overwrites
Paperclip-owned columns from a GitHub event without an explicit opt-in.

## Status

**Phase 1 — Commits A, B, C (foundation complete).** Currently delivered:

- Package scaffolding, manifest, instance config schema
- Plugin DB schema (`gh_repo_links`, `gh_issue_mirrors`, `gh_pr_mirrors`, `gh_webhook_deliveries`)
- Config validation surface with cross-field rules + 16 tests
- Auth layer: GitHub App JWT signing, installation token minting/caching, PAT fallback
- Typed GitHub REST API client with pagination and rate-limit detection
- Webhook signature verification (HMAC-SHA256, timing-safe)
- Webhook delivery deduplication via plugin DB
- Webhook dispatcher + 5 event handlers (`push`, `issues`, `pull_request`, `workflow_run`, `check_run`)
- 3 plugin tools wired in the worker:
  - `github.connectRepository`
  - `github.disconnectRepository`
  - `github.listRepositories`
- 69 tests across 6 test files

- Phase 2 additions:
  - DB schema extensions: `gh_check_mirrors`, `gh_branch_mirrors`, `gh_outbound_audit`
  - 8 additional webhook handlers: `pull_request_review`, `pull_request_review_comment`, `issue_comment`, `check_suite`, `create`, `delete`, `repository`
  - Sync engine: initial import, reconciliation with 24h overlap window, cursor management
  - 7 new plugin tools:
    - `github.syncRepository`
    - `github.reconcileRepository`
    - `github.listIssues`
    - `github.listPullRequests`
    - `github.getWorkflowStatus`
    - `github.getRecentCommits`
    - `github.getChangedFilesForPullRequest`
  - Tests for new handlers, pagination, and reconciliation

- Phase 3 core additions:
  - DB schema extensions: `gh_issue_ticket_links`, `gh_pr_task_links`
  - Outbound-write audit envelope (`audit/outbound-writes.ts`)
  - 5 new plugin tools:
    - `github.linkIssueToTicket`
    - `github.linkPullRequestToTask`
    - `github.createIssueFromTicket`
    - `github.commentOnIssue`
    - `github.commentOnPullRequest`
  - Tools registered in manifest and worker
  - Type-safe comment response type (`GitHubComment`)

- Phase 3 UI additions:
  - UI entrypoint (`src/ui/index.tsx`)
  - ProjectPanel (detailTab for projects)
  - IssuePanel (detailTab for issues)
  - SettingsPage (page slot)
  - UI slots registered in manifest
  - UI capabilities declared in manifest

- Phase 3 test additions:
  - Outbound-write audit tests (`tests/audit.spec.ts`)
  - Tests for `generateAuditId` and `redactHeaders`

- Phase 3 documentation additions:
  - `docs/plugins/github-sync/LIMITATIONS.md`
  - `docs/plugins/github-sync/PAT-DEV-FALLBACK.md`

## Development

```bash
# From repo root
pnpm install
pnpm --filter @paperclipai/plugin-github-sync typecheck
pnpm --filter @paperclipai/plugin-github-sync test
pnpm --filter @paperclipai/plugin-github-sync build
```

Watch builds:

```bash
pnpm --filter @paperclipai/plugin-github-sync dev
```

## Database namespace

The plugin owns the Postgres schema `plugin_github_sync_60491d4d6b`. This name
is derived deterministically by the host as
`plugin_<slug>_<sha256(pluginId).slice(0,10)>`. **If `PLUGIN_ID` is ever
changed in `src/constants.ts`, the hash must be recomputed and all migration
files updated.** The host validates that every SQL statement only references
this namespace (plus a whitelist of `public.*` read tables) and rejects
migrations that escape.

Allowed `public.*` read tables for this plugin: `companies`, `projects`, `issues`.

## Auth

Production path: GitHub App. Required config:

- `appId` — numeric App ID
- `installationId` — numeric installation ID
- `privateKeySecretRef` — Paperclip secret ref to a PEM-encoded RSA private key
- `webhookSecretRef` — Paperclip secret ref to the webhook shared secret

Dev fallback: classic or fine-grained PAT via `patSecretRef`. **Refused in
`prod` mode unless `allowPatInProd: true` is explicitly set.**

Full setup walkthrough lands with Commit C documentation
(`docs/plugins/github-sync/SETUP.md`).

## Architecture references

- Plan: [`doc/plans/2026-05-22-github-sync-plugin.md`](../../../doc/plans/2026-05-22-github-sync-plugin.md)
- Deferred decisions register: [`doc/plans/2026-05-22-github-sync-plugin-deferred-questions.md`](../../../doc/plans/2026-05-22-github-sync-plugin-deferred-questions.md)
- Plugin SDK: [`packages/plugins/sdk/README.md`](../sdk/README.md)
- Plugin spec: [`doc/plugins/PLUGIN_SPEC.md`](../../../doc/plugins/PLUGIN_SPEC.md)
