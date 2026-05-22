/**
 * Auth provider factory and re-exports.
 *
 * The worker resolves secrets via `ctx.secrets.resolve()` and passes the
 * resulting plain strings to `createAuthProvider`. This keeps the auth
 * layer testable without a live plugin context.
 */
import type { GitHubSyncConfig } from "../config/schema.js";
import { GitHubAuthError } from "../errors.js";
import { GitHubAppAuth } from "./githubAppAuth.js";
import { PatAuth } from "./patAuth.js";
import type { AuthProvider, ResolvedSecrets } from "./types.js";

export * from "./types.js";
export { GitHubAppAuth } from "./githubAppAuth.js";
export { PatAuth } from "./patAuth.js";
export { InMemoryTokenStore } from "./tokenStore.js";

/**
 * Create the appropriate AuthProvider for the resolved configuration.
 *
 * Rules:
 *   - `dev` mode with a PAT → PatAuth (simplest path)
 *   - `dev` mode with only App credentials → GitHubAppAuth
 *   - `prod` mode → GitHubAppAuth (PAT is ignored unless allowPatInProd)
 *
 * Failure modes:
 *   - Missing required credentials → GitHubAuthError
 *   - Invalid private key format → caught at JWT creation time
 */
export function createAuthProvider(
  config: GitHubSyncConfig,
  secrets: ResolvedSecrets,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): AuthProvider {
  if (config.syncMode === "dev" && secrets.pat) {
    return new PatAuth(secrets.pat);
  }

  if (!secrets.privateKey) {
    throw new GitHubAuthError(
      "Private key is required for GitHub App authentication.",
    );
  }
  if (!config.appId || !config.installationId) {
    throw new GitHubAuthError(
      "appId and installationId are required for GitHub App authentication.",
    );
  }

  return new GitHubAppAuth(
    {
      appId: config.appId,
      installationId: config.installationId,
      privateKey: secrets.privateKey,
    },
    fetchImpl,
  );
}
