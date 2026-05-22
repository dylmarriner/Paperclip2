/**
 * Tests for the GitHub REST API client.
 *
 * Coverage:
 *   - GET request with auth headers
 *   - POST request with body
 *   - Pagination via Link headers
 *   - Rate limit detection (429 + x-ratelimit-remaining: 0)
 *   - Non-2xx error handling
 *   - Network error handling
 */
import { describe, expect, it, vi } from "vitest";
import { GitHubClient } from "../src/http/githubClient.js";
import {
  GitHubApiError,
  GitHubRateLimitError,
} from "../src/errors.js";
import { mockAuthProvider } from "./helpers.js";

function mockFetch(
  responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>,
): typeof fetch {
  let idx = 0;
  return async () => {
    const resp = responses[idx++];
    if (!resp) throw new Error("Unexpected fetch call");
    return new Response(JSON.stringify(resp.body), {
      status: resp.status,
      headers: resp.headers ?? {},
    });
  };
}

describe("GitHubClient", () => {
  it("GETs a repository and returns typed data", async () => {
    const fetch = mockFetch([
      {
        status: 200,
        body: { id: 1, name: "repo", full_name: "owner/repo", default_branch: "main" },
      },
    ]);
    const client = new GitHubClient(mockAuthProvider("token"), fetch);
    const repo = await client.getRepository("owner", "repo");
    expect(repo.name).toBe("repo");
    expect(repo.full_name).toBe("owner/repo");
  });

  it("paginates through Link headers", async () => {
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("page=2")) {
        return new Response(
          JSON.stringify([{ id: 3, number: 3, title: "c" }]),
          { status: 200, headers: {} },
        );
      }
      return new Response(
        JSON.stringify([{ id: 1, number: 1, title: "a" }, { id: 2, number: 2, title: "b" }]),
        {
          status: 200,
          headers: {
            link: '<https://api.github.com/repos/o/r/issues?page=2>; rel="next", <https://api.github.com/repos/o/r/issues?page=2>; rel="last"',
          },
        },
      );
    });

    const client = new GitHubClient(mockAuthProvider("token"), fetch as unknown as typeof fetch);
    const issues = await client.listIssues("o", "r");
    expect(issues).toHaveLength(3);
    expect(issues[0]!.title).toBe("a");
    expect(issues[2]!.title).toBe("c");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops pagination when no Link rel=next is present", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: 1, number: 1 }]), {
        status: 200,
        headers: {},
      }),
    );

    const client = new GitHubClient(mockAuthProvider("token"), fetch as unknown as typeof fetch);
    const issues = await client.listIssues("o", "r");
    expect(issues).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws GitHubRateLimitError on 429 with exhausted quota", async () => {
    const fetch = mockFetch([
      {
        status: 429,
        body: { message: "API rate limit exceeded" },
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
        },
      },
    ]);

    const client = new GitHubClient(mockAuthProvider("token"), fetch);
    await expect(client.getRepository("o", "r")).rejects.toThrow(
      GitHubRateLimitError,
    );
  });

  it("throws GitHubApiError on 404", async () => {
    const fetch = mockFetch([
      { status: 404, body: { message: "Not Found" } },
    ]);

    const client = new GitHubClient(mockAuthProvider("token"), fetch);
    await expect(client.getRepository("o", "r")).rejects.toThrow(
      GitHubApiError,
    );
  });

  it("marks 5xx errors as retryable", async () => {
    const fetch = mockFetch([
      { status: 502, body: { message: "Bad Gateway" } },
    ]);

    const client = new GitHubClient(mockAuthProvider("token"), fetch);
    try {
      await client.getRepository("o", "r");
      expect.fail("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubApiError);
      expect((err as GitHubApiError).retryable).toBe(true);
      expect((err as GitHubApiError).status).toBe(502);
    }
  });

  it("throws GitHubApiError on network failure", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const client = new GitHubClient(
      mockAuthProvider("token"),
      fetch as unknown as typeof fetch,
    );
    await expect(client.getRepository("o", "r")).rejects.toThrow(
      GitHubApiError,
    );
  });

  it("POSTs a new issue with JSON body", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: 99, number: 42, title: "New Issue" }),
        { status: 201 },
      ),
    );

    const client = new GitHubClient(
      mockAuthProvider("token"),
      fetch as unknown as typeof fetch,
    );
    const issue = await client.createIssue("o", "r", {
      title: "New Issue",
      body: "Details here",
    });
    expect(issue.number).toBe(42);

    const call = fetch.mock.calls[0] as [string, RequestInit];
    expect(call[1]!.method).toBe("POST");
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      title: "New Issue",
      body: "Details here",
    });
  });
});
