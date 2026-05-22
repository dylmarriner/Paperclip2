/**
 * Auth provider interface abstracting GitHub App vs PAT authentication.
 *
 * The GitHub client receives an `AuthProvider` and calls `getAuthHeaders()`
 * before every outbound request. For GitHub App auth this may trigger a
 * JWT creation + token exchange; for PAT auth it is a synchronous header
 * construction.
 */
export interface AuthProvider {
  /** Return the Authorization header(s) needed for GitHub API calls. */
  getAuthHeaders(): Promise<Record<string, string>>;
}

/**
 * Resolved secrets passed to the auth factory. These are the *values*
 * obtained by calling `ctx.secrets.resolve(ref)` in the worker, not the
 * refs themselves.
 */
export interface ResolvedSecrets {
  /** PEM-encoded RSA private key for GitHub App JWT signing. */
  privateKey?: string;
  /** Shared secret for webhook signature verification. */
  webhookSecret: string;
  /** Personal access token (dev fallback). */
  pat?: string;
}
