/**
 * Tests for plugin tools.
 *
 * Coverage:
 *   - connectRepository inserts a repo link
 *   - disconnectRepository deletes a repo link and reports deletion status
 *   - listRepositories returns mapped repo rows
 */
import { describe, expect, it, vi } from "vitest";
import {
  makeConnectRepository,
  makeDisconnectRepository,
  makeListRepositories,
} from "../src/tools/index.js";
import { mockPluginContext, mockToolRunContext } from "./helpers.js";

describe("connectRepository tool", () => {
  it("inserts a repo link", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    const handler = makeConnectRepository(ctx);

    const result = await handler(
      { repoOwner: "paperclipai", repoName: "paperclip" },
      mockToolRunContext(),
    );

    expect(result.content).toContain("connected");
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO"),
      ["company-1", "paperclipai", "paperclip"],
    );
  });
});

describe("disconnectRepository tool", () => {
  it("deletes an existing repo link", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ctx = mockPluginContext({ executeFn: execute });
    const handler = makeDisconnectRepository(ctx);

    const result = await handler(
      { repoOwner: "paperclipai", repoName: "paperclip" },
      mockToolRunContext(),
    );

    expect(result.content).toContain("disconnected");
    expect(result.data).toEqual({ deleted: true });
  });

  it("reports not linked when rowCount is 0", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 0 });
    const ctx = mockPluginContext({ executeFn: execute });
    const handler = makeDisconnectRepository(ctx);

    const result = await handler(
      { repoOwner: "paperclipai", repoName: "paperclip" },
      mockToolRunContext(),
    );

    expect(result.content).toContain("was not linked");
    expect(result.data).toEqual({ deleted: false });
  });
});

describe("listRepositories tool", () => {
  it("returns mapped repo rows", async () => {
    const query = vi.fn().mockResolvedValue([
      { repo_owner: "o1", repo_name: "r1", created_at: "2024-01-01", updated_at: "2024-01-02" },
      { repo_owner: "o2", repo_name: "r2", created_at: "2024-02-01", updated_at: "2024-02-02" },
    ]);
    const ctx = mockPluginContext({ queryFn: query });
    const handler = makeListRepositories(ctx);

    const result = await handler({}, mockToolRunContext());

    expect(result.content).toContain("2");
    const data = result.data as { repos: unknown[] };
    expect(data.repos).toHaveLength(2);
    expect(data.repos[0]).toEqual({
      repoOwner: "o1",
      repoName: "r1",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-02",
    });
  });
});
