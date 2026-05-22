/**
 * Outbound-write audit envelope.
 *
 * Every outbound write tool inserts an activity_log "intent" row before the HTTP call
 * and a follow-up "result" row after, joined by a UUID.
 *
 * Invariants:
 *   - Intent row created before HTTP call (with redacted request body)
 *   - Result row updated after HTTP call (with response status and ETag)
 *   - Authorization and signature headers are redacted before persistence
 *   - Audit rows are joined by audit_id UUID
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { PLUGIN_DB_NAMESPACE } from "../constants.js";

export interface AuditIntent {
  auditId: string;
  actor: string;
  tool: string;
  targetUrl: string;
  requestBodyRedacted: string;
  startedAt: string;
}

export interface AuditResult {
  auditId: string;
  responseStatus: number;
  responseEtag: string | null;
  finishedAt: string;
  error: string | null;
}

export async function recordAuditIntent(
  ctx: PluginContext,
  intent: AuditIntent,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO ${PLUGIN_DB_NAMESPACE}.gh_outbound_audit
      (id, actor, tool, target_url, request_body_redacted, started_at, finished_at, error)
      VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)`,
    [
      intent.auditId,
      intent.actor,
      intent.tool,
      intent.targetUrl,
      intent.requestBodyRedacted,
      intent.startedAt,
      intent.startedAt,
    ],
  );
}

export async function recordAuditResult(
  ctx: PluginContext,
  result: AuditResult,
): Promise<void> {
  await ctx.db.execute(
    `UPDATE ${PLUGIN_DB_NAMESPACE}.gh_outbound_audit
    SET response_status = $1, response_etag = $2, finished_at = $3, error = $4
    WHERE id = $5`,
    [
      result.responseStatus,
      result.responseEtag,
      result.finishedAt,
      result.error,
      result.auditId,
    ],
  );
}

export function redactHeaders(headers: Headers): string {
  const redacted = new Headers();
  for (const [key, value] of headers.entries()) {
    const keyLower = key.toLowerCase();
    // Redact authorization, cookies, and sensitive token-related headers
    if (
      keyLower === "authorization" ||
      keyLower === "cookie" ||
      keyLower === "set-cookie" ||
      keyLower.includes("token") ||
      keyLower.includes("api-key") ||
      keyLower.includes("secret") ||
      keyLower.includes("private") ||
      keyLower.includes("password")
    ) {
      redacted.set(key, "***REDACTED***");
    } else if (keyLower.includes("signature")) {
      redacted.set(key, "***REDACTED***");
    } else {
      redacted.set(key, value);
    }
  }
  return JSON.stringify(Object.fromEntries(redacted.entries()));
}

export function generateAuditId(): string {
  return crypto.randomUUID();
}
