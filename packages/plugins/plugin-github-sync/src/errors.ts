/**
 * Structured error hierarchy for the GitHub Sync plugin.
 *
 * Every boundary layer (auth, HTTP, webhook, sync) throws errors that
 * carry enough context for the worker to decide whether to retry,
 * mark a delivery failed, or surface to the operator.
 *
 * Error-first invariant: no swallowed errors, no silent fallbacks.
 * Every public function documents its failure modes.
 */

/** Base class for all plugin-specific errors. */
export class GitHubSyncError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Authentication or token exchange failures. */
export class GitHubAuthError extends GitHubSyncError {
  constructor(message: string, retryable: boolean = false) {
    super(message, "GITHUB_AUTH_ERROR", retryable);
  }
}

/** GitHub REST API returned a non-2xx response. */
export class GitHubApiError extends GitHubSyncError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: unknown,
    retryable: boolean = false,
  ) {
    super(message, "GITHUB_API_ERROR", retryable);
  }
}

/** Rate limit or abuse-limit hit. Always retryable. */
export class GitHubRateLimitError extends GitHubApiError {
  readonly code = "GITHUB_RATE_LIMIT";
  constructor(
    message: string,
    status: number,
    public readonly resetAt: Date,
    public readonly remaining: number,
  ) {
    super(message, status, null, true);
  }
}

/** Webhook payload is structurally invalid or missing required fields. */
export class WebhookPayloadError extends GitHubSyncError {
  constructor(message: string) {
    super(message, "WEBHOOK_PAYLOAD_ERROR", false);
  }
}

/** Webhook signature verification failed. */
export class WebhookSignatureError extends GitHubSyncError {
  constructor(message: string) {
    super(message, "WEBHOOK_SIGNATURE_REJECTED", false);
  }
}

/** Webhook delivery is a duplicate (already processed). */
export class WebhookDuplicateError extends GitHubSyncError {
  constructor(public readonly deliveryId: string) {
    super(`Duplicate webhook delivery: ${deliveryId}`, "WEBHOOK_DUPLICATE", false);
  }
}
