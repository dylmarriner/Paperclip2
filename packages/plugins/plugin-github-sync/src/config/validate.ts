/**
 * Runtime config validation for the GitHub Sync plugin.
 *
 * Two consumers:
 *
 *   1. The plugin's `onValidateConfig` lifecycle hook returns a
 *      `PluginConfigValidationResult` to the host every time an operator
 *      saves config in the settings UI. The host blocks persistence
 *      when `ok: false`.
 *
 *   2. The plugin's `setup` reads the resolved config via `ctx.config.get()`
 *      and runs `parseConfigOrThrow` to obtain a strongly-typed
 *      `GitHubSyncConfig`. If parsing fails the worker throws at startup,
 *      which surfaces as a plugin health=error in the dashboard rather
 *      than silently mis-behaving.
 *
 * Both paths produce identical error messages so operators see the same
 * text in the UI and in worker logs.
 */
import type { PluginConfigValidationResult } from "@paperclipai/plugin-sdk";
import { instanceConfigZodSchema, type GitHubSyncConfig } from "./schema.js";

/**
 * Validate a config object and return a host-shaped result.
 *
 * Never throws. Returns `{ ok: false, errors: [...] }` for any parse or
 * cross-field failure. Returns `{ ok: true, warnings: [...] }` for valid
 * configs, including non-fatal warnings (e.g. PAT in prod with override).
 */
export function validateConfig(config: unknown): PluginConfigValidationResult {
  const parsed = instanceConfigZodSchema.safeParse(config);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.errors.map(formatZodIssue),
    };
  }

  const warnings: string[] = [];
  if (parsed.data.syncMode === "prod" && parsed.data.patSecretRef && parsed.data.allowPatInProd) {
    warnings.push(
      "PAT authentication is enabled in production mode (allowPatInProd=true). Prefer GitHub App credentials for production deployments.",
    );
  }
  if (parsed.data.allowAuthoritativeWrites) {
    warnings.push(
      "allowAuthoritativeWrites is true: Paperclip changes may push back to GitHub via explicit tool calls. Review tool invocations carefully.",
    );
  }
  if (parsed.data.autoCreateTickets) {
    warnings.push(
      "autoCreateTickets is true: every new GitHub issue will create a Paperclip ticket. Disable for noisy public repos.",
    );
  }

  return warnings.length > 0 ? { ok: true, warnings } : { ok: true };
}

/**
 * Parse + validate or throw a precise error. Used at worker startup.
 *
 * Throws an `Error` whose message contains every validation failure,
 * one per line, so a single log entry tells the operator everything
 * they need to fix.
 */
export function parseConfigOrThrow(config: unknown): GitHubSyncConfig {
  const parsed = instanceConfigZodSchema.safeParse(config);
  if (!parsed.success) {
    const lines = parsed.error.errors.map(formatZodIssue);
    throw new Error(
      `GitHub Sync plugin config is invalid:\n  - ${lines.join("\n  - ")}`,
    );
  }
  return parsed.data;
}

/**
 * Render a Zod issue into an operator-readable string.
 *
 * Format: `<path>: <message>` so operators can spot the offending field.
 * Paths are joined with `.` (root issues collapse to `<root>`).
 */
function formatZodIssue(issue: {
  path: (string | number)[];
  message: string;
}): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
  return `${path}: ${issue.message}`;
}
