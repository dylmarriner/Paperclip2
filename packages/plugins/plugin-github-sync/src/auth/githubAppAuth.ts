/**
 * GitHub App authentication provider.
 *
 * Flow:
 *   1. Create a short-lived JWT (10 min) signed with the App's RSA private key.
 *   2. Exchange the JWT for an installation access token (1 hour) via
 *      POST /app/installations/{installation_id}/access_tokens.
 *   3. Cache the installation token and return it in Authorization headers.
 *   4. Refresh the token when < 10 min remain.
 *
 * The JWT `iat` is backdated by 60 seconds to tolerate clock skew.
 *
 * Failure modes documented per method.
 */
import crypto from "crypto";
import {
  GitHubApiError,
  GitHubAuthError,
  GitHubRateLimitError,
} from "../errors.js";
import { GITHUB_API_BASE_URL, GITHUB_API_VERSION } from "../constants.js";
import type { AuthProvider } from "./types.js";
import { InMemoryTokenStore } from "./tokenStore.js";

const JWT_EXPIRY_SECONDS = 600; // 10 minutes
const CLOCK_SKEW_SECONDS = 60;

export interface GitHubAppAuthConfig {
  appId: string;
  installationId: string;
  privateKey: string;
}

export class GitHubAppAuth implements AuthProvider {
  private readonly store: InMemoryTokenStore;

  constructor(
    private readonly cfg: GitHubAppAuthConfig,
    private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
    store?: InMemoryTokenStore,
  ) {
    this.store = store ?? new InMemoryTokenStore();
  }

  /** Return cached installation token or mint a fresh one. */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const cached = this.store.get(this.cfg.installationId);
    if (cached) {
      return { Authorization: `Bearer ${cached}` };
    }

    const jwt = this.createJWT();
    const { token, expiresAt } = await this.exchangeJWTForToken(jwt);
    this.store.set(this.cfg.installationId, token, expiresAt);
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Create an RS256 JWT signed with the App's private key.
   *
   * Invariant: the private key must be a valid PEM-encoded RSA key.
   * Failure mode: throws GitHubAuthError with the OpenSSL error text.
   */
  createJWT(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(
      JSON.stringify({ alg: "RS256", typ: "JWT" }),
    );
    const payload = base64url(
      JSON.stringify({
        iat: now - CLOCK_SKEW_SECONDS,
        exp: now + JWT_EXPIRY_SECONDS,
        iss: this.cfg.appId,
      }),
    );
    const signingInput = `${header}.${payload}`;

    try {
      const signature = crypto
        .createSign("RSA-SHA256")
        .update(signingInput)
        .sign(this.cfg.privateKey, "base64url");
      return `${signingInput}.${signature}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new GitHubAuthError(`JWT signing failed: ${message}`);
    }
  }

  /**
   * Exchange the App JWT for an installation access token.
   *
   * Returns the token string and its absolute expiry as epoch ms.
   * Failure modes:
   *   - 401/403 → GitHubAuthError (bad JWT or App not installed)
   *   - 404 → GitHubAuthError (installation not found)
   *   - 429 → GitHubRateLimitError
   *   - 5xx → GitHubApiError with retryable=true
   *   - Network errors → GitHubAuthError with retryable=true
   */
  async exchangeJWTForToken(
    jwt: string,
  ): Promise<{ token: string; expiresAt: number }> {
    const url = `${GITHUB_API_BASE_URL}/app/installations/${this.cfg.installationId}/access_tokens`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          "User-Agent": `paperclip-plugin-github-sync`,
        },
      });
    } catch (err) {
      throw new GitHubAuthError(
        `Network error during token exchange: ${String(err)}`,
        true,
      );
    }

    if (!response.ok) {
      await handleApiError(response);
    }

    const data = (await response.json()) as {
      token: string;
      expires_at: string;
    };
    const expiresAt = new Date(data.expires_at).getTime();
    if (Number.isNaN(expiresAt)) {
      throw new GitHubAuthError(
        `Invalid expires_at in token exchange response: ${data.expires_at}`,
      );
    }
    return { token: data.token, expiresAt };
  }
}

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

async function handleApiError(response: Response): Promise<never> {
  const body = await response.json().catch(() => ({ message: "Unknown error" }));

  if (response.status === 429) {
    const reset = response.headers.get("x-ratelimit-reset");
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new GitHubRateLimitError(
      body.message || "Rate limit exceeded",
      response.status,
      new Date(parseInt(reset ?? "0") * 1000),
      parseInt(remaining ?? "0"),
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new GitHubAuthError(
      `GitHub rejected token exchange: ${response.status} ${body.message || ""}`,
    );
  }

  if (response.status === 404) {
    throw new GitHubAuthError(
      `GitHub installation not found: ${response.status} ${body.message || ""}`,
    );
  }

  throw new GitHubApiError(
    body.message || `HTTP ${response.status}`,
    response.status,
    body,
    response.status >= 500,
  );
}
