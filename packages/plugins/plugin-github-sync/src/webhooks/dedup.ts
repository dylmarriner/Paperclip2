/**
 * Webhook delivery deduplication using the plugin database.
 *
 * The host records every webhook delivery in `plugin_webhook_deliveries`
 * with a unique `delivery_id` (from the `X-GitHub-Delivery` header). The
 * plugin's `recordWebhookDelivery` function inserts the delivery ID and
 * timestamp into its namespaced `gh_webhook_deliveries` table.
 *
 * If the delivery ID already exists, the insert is skipped and the caller
 * should reject the duplicate without processing.
 *
 * Invariant: deduplication is idempotent — recording the same delivery
 * twice is a no-op, not an error.
 *
 * Failure modes:
 *   - DB unavailable → throws (caller retries)
 *   - Duplicate delivery → returns { isDuplicate: true }
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { WebhookDuplicateError } from "../errors.js";
import { PLUGIN_DB_NAMESPACE } from "../constants.js";

export interface RecordWebhookResult {
  /** True if this delivery has already been processed. */
  isDuplicate: boolean;
  /** The delivery ID that was recorded. */
  deliveryId: string;
}

/**
 * Record a webhook delivery in the plugin's dedup table.
 *
 * Uses an `INSERT ... ON CONFLICT DO NOTHING` pattern so that duplicate
 * delivery IDs are silently ignored.
 *
 * @param ctx - Plugin context for database access
 * @param deliveryId - The X-GitHub-Delivery UUID
 * @param eventType - The X-GitHub-Event header value (e.g. "push")
 * @param rawPayload - The raw request body string
 * @returns Result indicating whether this was a duplicate
 */
export async function recordWebhookDelivery(
  ctx: PluginContext,
  deliveryId: string,
  eventType: string,
  rawPayload: string,
): Promise<RecordWebhookResult> {
  const sql = `INSERT INTO "${PLUGIN_DB_NAMESPACE}".gh_webhook_deliveries
    (delivery_id, event_type, raw_payload, received_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (delivery_id) DO NOTHING`;

  const result = await ctx.db.execute(sql, [
    deliveryId,
    eventType,
    rawPayload,
  ]);

  if (result.rowCount === 0) {
    throw new WebhookDuplicateError(deliveryId);
  }

  return { isDuplicate: false, deliveryId };
}
