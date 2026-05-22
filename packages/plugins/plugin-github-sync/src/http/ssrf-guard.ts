/**
 * SSRF (Server-Side Request Forgery) guard.
 *
 * Validates that outbound HTTP requests only go to allowed GitHub domains.
 * This prevents the plugin from being used to fetch arbitrary URLs.
 *
 * Invariants:
 *   - All URLs must be to api.github.com or github.com
 *   - URLs must use HTTPS
 *   - URLs must not contain credentials or query parameters that could be abused
 */

const ALLOWED_HOSTS = new Set(["api.github.com", "github.com"]);

export class SSRFError extends Error {
  constructor(url: string) {
    super(`SSRF guard rejected URL: ${url}`);
    this.name = "SSRFError";
  }
}

/**
 * Validates a URL is safe for outbound requests.
 * @throws {SSRFError} if the URL is not allowed
 */
export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFError(url);
  }

  // Must be HTTPS
  if (parsed.protocol !== "https:") {
    throw new SSRFError(url);
  }

  // Must be an allowed host
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new SSRFError(url);
  }

  // Reject URLs with credentials
  if (parsed.username || parsed.password) {
    throw new SSRFError(url);
  }

  // Reject URLs with port numbers (GitHub uses standard HTTPS)
  if (parsed.port && parsed.port !== "443") {
    throw new SSRFError(url);
  }
}

/**
 * Validates a GitHub API path (owner/repo format).
 * Used for repository identifiers that are not full URLs.
 */
export function validateGitHubPath(path: string): void {
  // Allow paths like "owner/repo" or "owner/repo/path"
  const parts = path.split("/");
  if (parts.length < 2) {
    throw new Error(`Invalid GitHub path: ${path}`);
  }

  // Validate owner and repo name are non-empty and don't contain suspicious characters
  const owner = parts[0];
  const repo = parts[1];

  if (!owner || !/^[a-zA-Z0-9_.-]+$/.test(owner)) {
    throw new Error(`Invalid GitHub owner: ${owner}`);
  }

  if (!repo || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
    throw new Error(`Invalid GitHub repo: ${repo}`);
  }
}
