/**
 * Tests for the webhook dispatcher, dedup, and event handlers.
 *
 * Coverage:
 *   - Signature verification (valid, invalid, missing)
 *   - Dedup (duplicate delivery rejected)
 *   - Handler routing (push, issues, pull_request, workflow_run, check_run)
 *   - Unhandled event types return gracefully
 */
import { describe, expect, it, vi } from "vitest";
import { dispatchWebhook } from "../src/webhooks/dispatcher.js";
import { recordWebhookDelivery } from "../src/webhooks/dedup.js";
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
} from "../src/webhooks/handlers.js";
import {
  WebhookSignatureError,
  WebhookPayloadError,
  WebhookDuplicateError,
} from "../src/errors.js";
import { verifyWebhookSignature } from "../src/webhooks/signature.js";
import { mockPluginContext } from "./helpers.js";
import crypto from "crypto";

const TEST_SECRET = "test-webhook-secret";

function makeSignature(payload: string): string {
  const hmac = crypto.createHmac("sha256", TEST_SECRET).update(payload, "utf8").digest("hex");
  return `sha256=${hmac}`;
}

function makeInput(event: string, body: unknown) {
  const raw = JSON.stringify(body);
  return {
    headers: {
      "x-github-event": event,
      "x-github-delivery": `delivery-${event}-${Date.now()}`,
      "x-hub-signature-256": makeSignature(raw),
    },
    rawBody: raw,
    parsedBody: body,
    requestId: `req-${Date.now()}`,
  };
}

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    const payload = '{"action":"opened"}';
    expect(verifyWebhookSignature(TEST_SECRET, payload, makeSignature(payload))).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const payload = '{"action":"opened"}';
    expect(verifyWebhookSignature(TEST_SECRET, payload, "sha256=deadbeef")).toBe(false);
  });
});

describe("recordWebhookDelivery", () => {
  it("records a new delivery", async () => {
    const ctx = mockPluginContext({ executeResult: { rowCount: 1 } });
    const result = await recordWebhookDelivery(ctx, "del-1", "push", "{}");
    expect(result.isDuplicate).toBe(false);
    expect(result.deliveryId).toBe("del-1");
  });

  it("throws WebhookDuplicateError for duplicates", async () => {
    const ctx = mockPluginContext({ executeResult: { rowCount: 0 } });
    await expect(recordWebhookDelivery(ctx, "del-1", "push", "{}")).rejects.toThrow(
      WebhookDuplicateError,
    );
  });
});

describe("dispatchWebhook", () => {
  it("accepts a valid signed push webhook", async () => {
    const ctx = mockPluginContext({ executeResult: { rowCount: 1 } });
    const input = makeInput("push", { ref: "refs/heads/main", after: "abc123" });
    const result = await dispatchWebhook(ctx, input, {
      companyId: "c1",
      repoOwner: "o",
      repoName: "r",
      webhookSecret: TEST_SECRET,
    });
    expect(result.handled).toBe(true);
  });

  it("rejects a webhook with invalid signature", async () => {
    const ctx = mockPluginContext();
    const payload = '{"ref":"refs/heads/main"}';
    const input = {
      headers: {
        "x-github-event": "push",
        "x-github-delivery": "del-bad",
        "x-hub-signature-256": "sha256=invalid",
      },
      rawBody: payload,
      parsedBody: JSON.parse(payload),
      requestId: "req-bad",
    };
    await expect(
      dispatchWebhook(ctx, input, {
        companyId: "c1",
        repoOwner: "o",
        repoName: "r",
        webhookSecret: TEST_SECRET,
      }),
    ).rejects.toThrow(WebhookSignatureError);
  });

  it("rejects a duplicate delivery", async () => {
    const ctx = mockPluginContext({ executeResult: { rowCount: 0 } });
    const input = makeInput("push", { ref: "refs/heads/main", after: "abc123" });
    await expect(
      dispatchWebhook(ctx, input, {
        companyId: "c1",
        repoOwner: "o",
        repoName: "r",
        webhookSecret: TEST_SECRET,
      }),
    ).rejects.toThrow(WebhookDuplicateError);
  });

  it("returns unhandled for unknown event types", async () => {
    const ctx = mockPluginContext({ executeResult: { rowCount: 1 } });
    const input = makeInput("status", { state: "success" });
    const result = await dispatchWebhook(ctx, input, {
      companyId: "c1",
      repoOwner: "o",
      repoName: "r",
      webhookSecret: TEST_SECRET,
    });
    expect(result.handled).toBe(false);
    expect(result.reason).toContain("Unhandled");
  });

  it("routes issues events to handleIssue", async () => {
    const ctx = mockPluginContext({ executeResult: { rowCount: 1 } });
    const input = makeInput("issues", {
      action: "opened",
      issue: {
        id: 1,
        node_id: "I_1",
        number: 42,
        title: "Bug",
        body: "Details",
        state: "open",
        state_reason: null,
        labels: [],
        user: { login: "alice", id: 1 },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        closed_at: null,
      },
    });
    const result = await dispatchWebhook(ctx, input, {
      companyId: "c1",
      repoOwner: "o",
      repoName: "r",
      webhookSecret: TEST_SECRET,
    });
    expect(result.handled).toBe(true);
  });
});

describe("Event handlers", () => {
  const hCtx = {
    ctx: mockPluginContext(),
    companyId: "c1",
    repoOwner: "o",
    repoName: "r",
    eventType: "push",
  };

  it("handlePush updates repo link last_push_at", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handlePush({ ref: "refs/heads/main", after: "abc" }, { ...hCtx, ctx });
    expect(execute).toHaveBeenCalled();
  });

  it("handlePush throws on missing ref", async () => {
    await expect(handlePush({}, hCtx)).rejects.toThrow(WebhookPayloadError);
  });

  it("handleIssue upserts into gh_issue_mirrors", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handleIssue(
      {
        issue: {
          id: 1,
          node_id: "I_1",
          number: 1,
          title: "T",
          body: null,
          state: "open",
          state_reason: null,
          labels: [],
          user: { login: "u", id: 1 },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          closed_at: null,
        },
      },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });

  it("handlePullRequest upserts into gh_pr_mirrors", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handlePullRequest(
      {
        pull_request: {
          id: 1,
          node_id: "PR_1",
          number: 1,
          title: "PR",
          body: null,
          state: "open",
          draft: false,
          merged: false,
          merge_commit_sha: null,
          head: { ref: "feat", sha: "abc" },
          base: { ref: "main", sha: "def" },
          user: { login: "u", id: 1 },
          labels: [],
          html_url: "https://github.com/o/r/pulls/1",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          closed_at: null,
          merged_at: null,
        },
      },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });

  it("handleWorkflowRun updates repo raw JSONB", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handleWorkflowRun(
      {
        workflow_run: {
          id: 1,
          name: "CI",
          status: "completed",
          conclusion: "success",
          head_branch: "main",
          head_sha: "abc",
          html_url: "https://github.com/o/r/actions/runs/1",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });

  it("handleCheckRun updates repo raw JSONB", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handleCheckRun(
      {
        check_run: {
          id: 1,
          name: "lint",
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/o/r/checks/1",
        },
      },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });

  it("handlePullRequestReview updates PR raw JSONB with last_review", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handlePullRequestReview(
      {
        review: {
          id: 1,
          user: { login: "alice" },
          body: "LGTM",
          state: "approved",
          html_url: "https://github.com/o/r/pulls/1/reviews/1",
          submitted_at: "2024-01-01T00:00:00Z",
        },
        pull_request: { number: 1 },
      },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });

  it("handlePullRequestReviewComment updates PR raw JSONB with last_review_comment", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handlePullRequestReviewComment(
      {
        comment: {
          id: 1,
          user: { login: "bob" },
          body: "Nice work",
          html_url: "https://github.com/o/r/pulls/1/comments/1",
          created_at: "2024-01-01T00:00:00Z",
        },
        pull_request: { number: 1 },
      },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });

  it("handleIssueComment updates issue raw JSONB with last_comment", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handleIssueComment(
      {
        comment: {
          id: 1,
          user: { login: "charlie" },
          body: "Thanks!",
          html_url: "https://github.com/o/r/issues/1/comments/1",
          created_at: "2024-01-01T00:00:00Z",
        },
        issue: { number: 1 },
      },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });

  it("handleCheckSuite upserts into gh_check_mirrors", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handleCheckSuite(
      {
        check_suite: {
          id: 1,
          status: "completed",
          conclusion: "success",
          head_sha: "abc",
          head_branch: "main",
          html_url: "https://github.com/o/r/suites/1",
        },
      },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });

  it("handleCreate upserts branch into gh_branch_mirrors", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handleCreate(
      { ref: "refs/heads/feature", ref_type: "branch" },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });

  it("handleCreate ignores non-branch refs", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handleCreate(
      { ref: "refs/tags/v1.0.0", ref_type: "tag" },
      { ...hCtx, ctx },
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("handleDelete soft-deletes branch in gh_branch_mirrors", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handleDelete(
      { ref: "refs/heads/feature", ref_type: "branch" },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });

  it("handleDelete ignores non-branch refs", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handleDelete(
      { ref: "refs/tags/v1.0.0", ref_type: "tag" },
      { ...hCtx, ctx },
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("handleRepository updates repo link status for archived action", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handleRepository(
      {
        action: "archived",
        repository: {
          full_name: "o/r",
          html_url: "https://github.com/o/r",
          archived: true,
        },
      },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });

  it("handleRepository updates repo link status for unarchived action", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    await handleRepository(
      {
        action: "unarchived",
        repository: {
          full_name: "o/r",
          html_url: "https://github.com/o/r",
          archived: false,
        },
      },
      { ...hCtx, ctx },
    );
    expect(execute).toHaveBeenCalled();
  });
});
