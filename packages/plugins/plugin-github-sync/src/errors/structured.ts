/**
 * Structured error classification for UI surfacing.
 *
 * Provides clear, actionable error messages for the UI.
 * Errors are classified by category and include recovery suggestions.
 *
 * Invariants:
 *   - Every error has a user-friendly message
 *   - Every error has a recovery suggestion
 *   - Errors are categorized for UI grouping
 */

export enum ErrorCategory {
  AUTHENTICATION = "authentication",
  AUTHORIZATION = "authorization",
  RATE_LIMIT = "rate_limit",
  NETWORK = "network",
  NOT_FOUND = "not_found",
  VALIDATION = "validation",
  SSRF = "ssrf",
  UNKNOWN = "unknown",
}

export interface StructuredError {
  category: ErrorCategory;
  userMessage: string;
  technicalMessage: string;
  recovery: string;
  code: string;
  context?: Record<string, unknown>;
}

export class GitHubSyncError extends Error {
  constructor(
    public structured: StructuredError,
    cause?: Error,
  ) {
    super(structured.userMessage);
    this.name = "GitHubSyncError";
    this.cause = cause;
  }
}

/**
 * Creates a structured error for authentication failures.
 */
export function createAuthError(technicalMessage: string, context?: Record<string, unknown>): GitHubSyncError {
  return new GitHubSyncError({
    category: ErrorCategory.AUTHENTICATION,
    userMessage: "GitHub authentication failed. Please check your GitHub App credentials or PAT configuration.",
    technicalMessage,
    recovery: "Verify appId, installationId, and privateKeySecretRef are configured correctly in the plugin settings.",
    code: "AUTH_FAILED",
    context,
  });
}

/**
 * Creates a structured error for authorization failures.
 */
export function createAuthzError(technicalMessage: string, context?: Record<string, unknown>): GitHubSyncError {
  return new GitHubSyncError({
    category: ErrorCategory.AUTHORIZATION,
    userMessage: "GitHub authorization failed. The plugin does not have permission to access the requested resource.",
    technicalMessage,
    recovery: "Ensure the GitHub App has the required repository permissions for this operation.",
    code: "AUTHZ_FAILED",
    context,
  });
}

/**
 * Creates a structured error for rate limit failures.
 */
export function createRateLimitError(remaining: number, resetAt: Date, context?: Record<string, unknown>): GitHubSyncError {
  return new GitHubSyncError({
    category: ErrorCategory.RATE_LIMIT,
    userMessage: "GitHub API rate limit exceeded. The plugin will retry automatically.",
    technicalMessage: `Rate limit exceeded. Remaining: ${remaining}, Reset at: ${resetAt.toISOString()}`,
    recovery: "Wait for the rate limit to reset or reduce sync frequency.",
    code: "RATE_LIMIT_EXCEEDED",
    context: { remaining, resetAt: resetAt.toISOString(), ...context },
  });
}

/**
 * Creates a structured error for network failures.
 */
export function createNetworkError(technicalMessage: string, context?: Record<string, unknown>): GitHubSyncError {
  return new GitHubSyncError({
    category: ErrorCategory.NETWORK,
    userMessage: "Network error communicating with GitHub. Please check your connection.",
    technicalMessage,
    recovery: "Check your network connection and GitHub service status at https://www.githubstatus.com.",
    code: "NETWORK_ERROR",
    context,
  });
}

/**
 * Creates a structured error for not found failures.
 */
export function createNotFoundError(resource: string, context?: Record<string, unknown>): GitHubSyncError {
  return new GitHubSyncError({
    category: ErrorCategory.NOT_FOUND,
    userMessage: `GitHub resource not found: ${resource}. It may have been deleted or moved.`,
    technicalMessage: `Resource not found: ${resource}`,
    recovery: "Verify the repository, issue, or pull request exists and is accessible.",
    code: "NOT_FOUND",
    context: { resource, ...context },
  });
}

/**
 * Creates a structured error for validation failures.
 */
export function createValidationError(field: string, reason: string, context?: Record<string, unknown>): GitHubSyncError {
  return new GitHubSyncError({
    category: ErrorCategory.VALIDATION,
    userMessage: `Invalid input: ${field} - ${reason}`,
    technicalMessage: `Validation failed for field ${field}: ${reason}`,
    recovery: "Correct the input and try again.",
    code: "VALIDATION_ERROR",
    context: { field, reason, ...context },
  });
}

/**
 * Creates a structured error for SSRF guard failures.
 */
export function createSSRFError(url: string, context?: Record<string, unknown>): GitHubSyncError {
  return new GitHubSyncError({
    category: ErrorCategory.SSRF,
    userMessage: "Invalid GitHub URL detected. The plugin only allows requests to api.github.com and github.com.",
    technicalMessage: `SSRF guard rejected URL: ${url}`,
    recovery: "Ensure the repository URL is a valid GitHub URL.",
    code: "SSRF_REJECTED",
    context: { url, ...context },
  });
}

/**
 * Creates a structured error for unknown failures.
 */
export function createUnknownError(technicalMessage: string, context?: Record<string, unknown>): GitHubSyncError {
  return new GitHubSyncError({
    category: ErrorCategory.UNKNOWN,
    userMessage: "An unexpected error occurred. Please check the logs for details.",
    technicalMessage,
    recovery: "Check the plugin logs and contact support if the issue persists.",
    code: "UNKNOWN_ERROR",
    context,
  });
}

/**
 * Converts a generic error to a structured error.
 */
export function toStructuredError(err: unknown, context?: Record<string, unknown>): GitHubSyncError {
  if (err instanceof GitHubSyncError) {
    return err;
  }

  if (err instanceof Error) {
    return createUnknownError(err.message, { ...context, originalError: err.message });
  }

  return createUnknownError(String(err), context);
}
