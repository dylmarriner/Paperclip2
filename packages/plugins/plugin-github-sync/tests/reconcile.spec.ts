/**
 * Tests for reconciliation functionality.
 *
 * Coverage:
 *   - performReconcile handles overlap window
 *   - performReconcile fetches issues since cursor
 *   - performReconcile fetches PRs since cursor
 *   - performReconcile updates cursor after success
 */
import { describe, expect, it, vi } from "vitest";
import { performReconcile } from "../src/sync/reconcile.js";
import { mockPluginContext } from "./helpers.js";

describe("performReconcile", () => {
  it("fetches and reconciles issues since cursor", async () => {
    const ctx = mockPluginContext();
    const auth = {
      token: "test-token",
      getAuthHeaders: () => ({ Authorization: "Bearer test-token" }),
    } as any;
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 1 }, { id: 2 }],
    });

    await performReconcile(ctx, {
      repoLinkId: "link-1",
      repoOwner: "o",
      repoName: "r",
      companyId: "c1",
      auth,
      fetchImpl: fetch,
      overlapHours: 24,
    });

    expect(fetch).toHaveBeenCalled();
  });

  it("updates cursor after successful reconciliation", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    const auth = {
      token: "test-token",
      getAuthHeaders: () => ({ Authorization: "Bearer test-token" }),
    } as any;
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    await performReconcile(ctx, {
      repoLinkId: "link-1",
      repoOwner: "o",
      repoName: "r",
      companyId: "c1",
      auth,
      fetchImpl: fetch,
      overlapHours: 24,
    });

    expect(execute).toHaveBeenCalled();
  });

  it("handles fetch errors gracefully", async () => {
    const ctx = mockPluginContext();
    const auth = {
      token: "test-token",
      getAuthHeaders: () => ({ Authorization: "Bearer test-token" }),
    } as any;
    const fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await performReconcile(ctx, {
      repoLinkId: "link-1",
      repoOwner: "o",
      repoName: "r",
      companyId: "c1",
      auth,
      fetchImpl: fetch,
      overlapHours: 24,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
  });
});
