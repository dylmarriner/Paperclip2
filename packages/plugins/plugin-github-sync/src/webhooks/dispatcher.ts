/**
 * Webhook ingress dispatcher.
 *
 * Responsibilities:
 *   1. Verify the X-Hub-Signature-256 signature using the shared secret.
 *   2. Check delivery deduplication via the plugin DB.
 *   3. Route the event to the correct handler.
 *   4. Log the outcome (success, duplicate, or failure).
 *
 * The dispatcher is the single entry point for all GitHub webhook traffic.
 * It is called from the worker's `onWebhook` hook.
 *
 * Failure modes:
 *   - Missing signature → WebhookSignatureError (non-retryable)
 *   - Invalid signature → WebhookSignatureError (non-retryable)
 *   - Duplicate delivery → WebhookDuplicateError (non-retryable)
 *   - Handler throws retryable error → propagate for retry
 *   - Handler throws non-retryable error → log and return failure
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { verifyWebhookSignature } from "./signature.js";
import { recordWebhookDelivery } from "./dedup.js";
import {
  handlePush,
  handleIssue,
  handlePullRequest,
  handleWorkflowRun,
  handleCheckRun,
  handlePullRequestReview,
  handlePullRequestReviewComment,
  handleIssueComment,
  handleCheckSuite,
  handleCreate,
  handleDelete,
  handleRepository,
} from "./handlers.js";
import {
  WebhookSignatureError,
  WebhookPayloadError,
} from "../errors.js";

/** Input from the plugin host when a webhook arrives. */
export interface WebhookDispatchInput {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  parsedBody: unknown;
  requestId: string;
}

export interface DispatcherConfig {
  companyId: string;
  repoOwner: string;
  repoName: string;
  /** Resolved webhook secret value (not a reference). */
  webhookSecret: string;
}

export async function dispatchWebhook(
  ctx: PluginContext,
  input: WebhookDispatchInput,
  cfg: DispatcherConfig,
): Promise<{ handled: boolean; reason?: string }> {
  const signatureHeader = String(input.headers["x-hub-signature-256"] ?? "");
  const deliveryId = String(input.headers["x-github-delivery"] ?? "");
  const eventType = String(input.headers["x-github-event"] ?? "");

  if (!signatureHeader || !deliveryId || !eventType) {
    throw new WebhookPayloadError(
      "Missing required webhook headers (signature, delivery, or event type)",
    );
  }

  // 1. Resolve and verify signature
  const isValid = verifyWebhookSignature(cfg.webhookSecret, input.rawBody, signatureHeader);
  if (!isValid) {
    throw new WebhookSignatureError("Signature verification failed");
  }

  // 2. Record delivery (throws WebhookDuplicateError if duplicate)
  await recordWebhookDelivery(ctx, deliveryId, eventType, input.rawBody);

  // 3. Route to handler
  const handlerCtx = {
    ctx,
    companyId: cfg.companyId,
    repoOwner: cfg.repoOwner,
    repoName: cfg.repoName,
    eventType,
    action: getAction(input.parsedBody),
  };

  switch (eventType) {
    case "push":
      await handlePush(input.parsedBody, handlerCtx);
      break;
    case "issues":
      await handleIssue(input.parsedBody, handlerCtx);
      break;
    case "pull_request":
      await handlePullRequest(input.parsedBody, handlerCtx);
      break;
    case "pull_request_review":
      await handlePullRequestReview(input.parsedBody, handlerCtx);
      break;
    case "pull_request_review_comment":
      await handlePullRequestReviewComment(input.parsedBody, handlerCtx);
      break;
    case "issue_comment":
      await handleIssueComment(input.parsedBody, handlerCtx);
      break;
    case "workflow_run":
      await handleWorkflowRun(input.parsedBody, handlerCtx);
      break;
    case "check_run":
      await handleCheckRun(input.parsedBody, handlerCtx);
      break;
    case "check_suite":
      await handleCheckSuite(input.parsedBody, handlerCtx);
      break;
    case "create":
      await handleCreate(input.parsedBody, handlerCtx);
      break;
    case "delete":
      await handleDelete(input.parsedBody, handlerCtx);
      break;
    case "repository":
      await handleRepository(input.parsedBody, handlerCtx);
      break;
    default:
      ctx.logger.info(`Unhandled GitHub webhook event type: ${eventType}`, { deliveryId });
      return { handled: false, reason: `Unhandled event type: ${eventType}` };
  }

  ctx.logger.info(`Webhook handled`, { deliveryId, eventType, action: handlerCtx.action });
  return { handled: true };
}

function getAction(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "action" in payload) {
    return String((payload as Record<string, unknown>).action);
  }
  return undefined;
}
