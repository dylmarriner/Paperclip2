/**
 * Personal Access Token authentication provider.
 *
 * Dead-simple: returns the PAT as a Bearer token on every call.
 * No caching, no expiry, no refresh. The token is resolved once at
 * worker startup and stored as a string.
 */
import type { AuthProvider } from "./types.js";

export class PatAuth implements AuthProvider {
  constructor(private readonly pat: string) {}

  async getAuthHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${this.pat}` };
  }
}
