/**
 * GitHub API rate-limit handling.
 *
 * Invariants:
 *   - Never busy-loop; use setTimeout honoring X-RateLimit-Reset
 *   - Cap backoff at 30 seconds
 *   - Classify HTTP failures: auth_failed, not_found, rate_limited, server, network
 *   - Budget assertions prevent exhausting quota by refusing requests when budget is low
 */

export interface RateLimitInfo {
  remaining: number;
  reset: number; // Unix timestamp
  limit: number;
}

export class RateLimitError extends Error {
  constructor(
    public resetAt: number,
    message = "GitHub API rate limit exceeded",
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class RateLimitBudgetExceededError extends Error {
  constructor(
    public remaining: number,
    message = "GitHub API rate limit budget exceeded",
  ) {
    super(message);
    this.name = "RateLimitBudgetExceededError";
  }
}

export interface RateLimitBudget {
  minimumRemaining: number; // Minimum remaining requests before refusing
  warningThreshold: number; // Threshold for logging warnings
}

const DEFAULT_BUDGET: RateLimitBudget = {
  minimumRemaining: 10, // Refuse requests when fewer than 10 remain
  warningThreshold: 100, // Log warning when fewer than 100 remain
};

let currentBudget: RateLimitBudget = DEFAULT_BUDGET;

export function setRateLimitBudget(budget: Partial<RateLimitBudget>): void {
  currentBudget = { ...DEFAULT_BUDGET, ...budget };
}

export function getRateLimitBudget(): RateLimitBudget {
  return currentBudget;
}

/**
 * Checks if the rate limit budget allows proceeding with a request.
 * @throws {RateLimitBudgetExceededError} if remaining requests is below minimum
 */
export function checkRateLimitBudget(info: RateLimitInfo): void {
  if (info.remaining < currentBudget.minimumRemaining) {
    throw new RateLimitBudgetExceededError(
      info.remaining,
      `Rate limit budget exceeded: ${info.remaining} remaining (minimum: ${currentBudget.minimumRemaining})`,
    );
  }

  if (info.remaining < currentBudget.warningThreshold) {
    console.warn(
      `GitHub API rate limit warning: ${info.remaining} remaining (threshold: ${currentBudget.warningThreshold})`,
    );
  }
}

export function parseRateLimitHeaders(response: Response): RateLimitInfo | null {
  const remaining = response.headers.get("X-RateLimit-Remaining");
  const reset = response.headers.get("X-RateLimit-Reset");
  const limit = response.headers.get("X-RateLimit-Limit");

  if (remaining === null || reset === null || limit === null) {
    return null;
  }

  return {
    remaining: parseInt(remaining, 10),
    reset: parseInt(reset, 10),
    limit: parseInt(limit, 10),
  };
}

export async function waitForRateLimitReset(resetAt: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const waitSeconds = Math.max(0, resetAt - now);
  const cappedWaitMs = Math.min(waitSeconds * 1000, 30000); // 30s cap

  if (cappedWaitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, cappedWaitMs));
  }
}

export type HttpFailureKind =
  | "auth_failed"
  | "not_found"
  | "rate_limited"
  | "server"
  | "network";

export function classifyHttpFailure(
  response: Response,
  error?: unknown,
): HttpFailureKind {
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return "network";
  }

  if (!response) {
    return "network";
  }

  const status = response.status;
  const remaining = response.headers.get("X-RateLimit-Remaining");

  if (status === 401 || status === 403) {
    if (remaining === "0") {
      return "rate_limited";
    }
    return "auth_failed";
  }

  if (status === 404) {
    return "not_found";
  }

  if (status === 429 || (status === 403 && remaining === "0")) {
    return "rate_limited";
  }

  if (status >= 500) {
    return "server";
  }

  return "network";
}
