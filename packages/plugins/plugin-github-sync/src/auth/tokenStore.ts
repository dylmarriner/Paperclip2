/**
 * In-memory cache for GitHub App installation access tokens.
 *
 * Tokens are valid for 1 hour from issuance. We refresh when less than
 * 10 minutes remain to absorb clock skew and reduce race windows.
 *
 * This is a pure in-memory store (Map). It is scoped to the plugin
 * worker process. When the host restarts the worker the cache is
 * naturally cleared and the first outbound request re-fetches a token.
 *
 * Thread-safety: Node.js worker threads share nothing by default; a
 * simple Map is sufficient.
 */
export interface TokenCacheEntry {
  token: string;
  /** Epoch milliseconds when this token expires. */
  expiresAt: number;
}

const REFRESH_BUFFER_MS = 10 * 60 * 1000; // 10 minutes

export class InMemoryTokenStore {
  private cache = new Map<string, TokenCacheEntry>();

  /** Return a cached token or null if missing / expired / near expiry. */
  get(installationId: string): string | null {
    const entry = this.cache.get(installationId);
    if (!entry) return null;
    if (entry.expiresAt - Date.now() < REFRESH_BUFFER_MS) {
      this.cache.delete(installationId);
      return null;
    }
    return entry.token;
  }

  /** Store a token with its absolute expiry time. */
  set(installationId: string, token: string, expiresAt: number): void {
    this.cache.set(installationId, { token, expiresAt });
  }

  /** Clear all entries. Useful in tests and graceful shutdown. */
  clear(): void {
    this.cache.clear();
  }
}
