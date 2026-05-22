/**
 * Sync engine for GitHub repository initial import and reconciliation.
 *
 * Responsibilities:
 *   - Initial import: full fetch of repo metadata, issues, PRs, branches, commits, CI state
 *   - Reconciliation: periodic refresh of data since last_synced_at
 *   - Rate-limit handling: pause + retry on X-RateLimit-Remaining: 0
 *   - Pagination: follow Link headers, store ETags for conditional requests
 *
 * Invariants:
 *   - All writes use repo_link_id foreign key
 *   - Never mutate Paperclip-owned columns from sync
 *   - Rate-limit backoff never exceeds 30s cap
 *   - On failure: increment consecutive_failures, set status degraded after 3
 */

export * from "./initial-import.js";
export * from "./reconcile.js";
export * from "./rate-limit.js";
export * from "./pagination.js";
