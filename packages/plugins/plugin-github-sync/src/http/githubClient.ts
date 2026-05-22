/**
 * Typed GitHub REST API client for the sync plugin.
 *
 * Design principles:
 *   - Accept an `AuthProvider` + `fetch` impl for testability.
 *   - Handle pagination automatically via Link headers.
 *   - Surface rate limits as typed, retryable errors.
 *   - Return typed responses; raw JSON is preserved in mirror tables.
 *   - Every outbound call is auditable (activity_log) by the caller.
 *
 * The client does NOT emit activity logs internally — the worker
 * wrappers around these calls do that. This keeps the client focused
 * on HTTP mechanics and the worker focused on business logic.
 */
import {
  GitHubApiError,
  GitHubRateLimitError,
} from "../errors.js";
import {
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  OUTBOUND_USER_AGENT,
} from "../constants.js";
import type { AuthProvider } from "../auth/types.js";
import { validateUrl } from "./ssrf-guard.js";
import type {
  GitHubBranch,
  GitHubCheckRun,
  GitHubComment,
  GitHubCommit,
  GitHubIssue,
  GitHubLabel,
  GitHubMilestone,
  GitHubPullRequest,
  GitHubRepository,
  GitHubWorkflowRun,
} from "./types.js";

export interface GitHubClientLogger {
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export class GitHubClient {
  constructor(
    private readonly auth: AuthProvider,
    private readonly fetchImpl: typeof fetch,
    private readonly logger?: GitHubClientLogger,
  ) {}

  // -----------------------------------------------------------------------
  // Repository
  // -----------------------------------------------------------------------

  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    return this.get<GitHubRepository>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  }

  // -----------------------------------------------------------------------
  // Issues
  // -----------------------------------------------------------------------

  async listIssues(
    owner: string,
    repo: string,
    options: { state?: "open" | "closed" | "all"; per_page?: number } = {},
  ): Promise<GitHubIssue[]> {
    const params = new URLSearchParams();
    if (options.state) params.set("state", options.state);
    params.set("per_page", String(options.per_page ?? 100));
    return this.paginate<GitHubIssue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${params}`);
  }

  async getIssue(owner: string, repo: string, number: number): Promise<GitHubIssue> {
    return this.get<GitHubIssue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`);
  }

  // -----------------------------------------------------------------------
  // Pull Requests
  // -----------------------------------------------------------------------

  async listPullRequests(
    owner: string,
    repo: string,
    options: { state?: "open" | "closed" | "all"; per_page?: number } = {},
  ): Promise<GitHubPullRequest[]> {
    const params = new URLSearchParams();
    if (options.state) params.set("state", options.state);
    params.set("per_page", String(options.per_page ?? 100));
    return this.paginate<GitHubPullRequest>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${params}`);
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequest> {
    return this.get<GitHubPullRequest>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`);
  }

  async getPullRequestFiles(owner: string, repo: string, number: number): Promise<{ filename: string; status: string; additions: number; deletions: number }[]> {
    return this.paginate(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files`);
  }

  // -----------------------------------------------------------------------
  // Commits & Branches
  // -----------------------------------------------------------------------

  async listCommits(
    owner: string,
    repo: string,
    options: { sha?: string; per_page?: number } = {},
  ): Promise<GitHubCommit[]> {
    const params = new URLSearchParams();
    if (options.sha) params.set("sha", options.sha);
    params.set("per_page", String(options.per_page ?? 100));
    return this.paginate<GitHubCommit>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${params}`);
  }

  async listBranches(owner: string, repo: string): Promise<GitHubBranch[]> {
    return this.paginate<GitHubBranch>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`);
  }

  // -----------------------------------------------------------------------
  // Labels & Milestones
  // -----------------------------------------------------------------------

  async listLabels(owner: string, repo: string): Promise<GitHubLabel[]> {
    return this.paginate<GitHubLabel>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`);
  }

  async listMilestones(owner: string, repo: string): Promise<GitHubMilestone[]> {
    return this.paginate<GitHubMilestone>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/milestones`);
  }

  // -----------------------------------------------------------------------
  // Checks & Workflows
  // -----------------------------------------------------------------------

  async listCheckRuns(owner: string, repo: string, ref: string): Promise<{ check_runs: GitHubCheckRun[] }> {
    return this.get<{ check_runs: GitHubCheckRun[] }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}/check-runs`);
  }

  async listWorkflowRuns(
    owner: string,
    repo: string,
    options: { branch?: string; per_page?: number } = {},
  ): Promise<{ workflow_runs: GitHubWorkflowRun[] }> {
    const params = new URLSearchParams();
    if (options.branch) params.set("branch", options.branch);
    params.set("per_page", String(options.per_page ?? 100));
    return this.get<{ workflow_runs: GitHubWorkflowRun[] }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?${params}`);
  }

  // -----------------------------------------------------------------------
  // Outbound writes (Phase 3)
  // -----------------------------------------------------------------------

  async createIssue(
    owner: string,
    repo: string,
    params: { title: string; body?: string; labels?: string[]; assignees?: string[] },
  ): Promise<GitHubIssue> {
    return this.post<GitHubIssue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, params);
  }

  async createIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<GitHubComment> {
    return this.post<GitHubComment>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`, { body });
  }

  async createPullRequestComment(owner: string, repo: string, pullNumber: number, body: string): Promise<GitHubComment> {
    return this.post<GitHubComment>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${pullNumber}/comments`, { body });
  }

  async requestReviewers(
    owner: string,
    repo: string,
    pullNumber: number,
    reviewers: string[],
  ): Promise<unknown> {
    return this.post(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/requested_reviewers`, { reviewers });
  }

  // -----------------------------------------------------------------------
  // Core primitives
  // -----------------------------------------------------------------------

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const authHeaders = await this.auth.getAuthHeaders();
    const url = `${GITHUB_API_BASE_URL}${path}`;

    // SSRF guard: validate URL before making request
    validateUrl(url);

    const init: RequestInit = {
      method,
      headers: {
        ...authHeaders,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": OUTBOUND_USER_AGENT,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (err) {
      throw new GitHubApiError(
        `Network error: ${String(err)}`,
        0,
        null,
        true,
      );
    }

    if (!response.ok) {
      await throwOnError(response, this.logger);
    }

    // 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  /** Follow Link rel="next" headers until exhausted. */
  private async paginate<T>(initialPath: string, maxPages = 10): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = `${GITHUB_API_BASE_URL}${initialPath}`;
    let pages = 0;

    while (nextUrl && pages < maxPages) {
      // SSRF guard: validate URL before making request
      validateUrl(nextUrl);

      const authHeaders = await this.auth.getAuthHeaders();
      const response: Response = await this.fetchImpl(nextUrl, {
        headers: {
          ...authHeaders,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          "User-Agent": OUTBOUND_USER_AGENT,
        },
      });

      if (!response.ok) {
        await throwOnError(response, this.logger);
      }

      const pageData = (await response.json()) as T[];
      results.push(...pageData);

      const linkHeader: string | null = response.headers.get("link");
      nextUrl = linkHeader ? parseNextLink(linkHeader) : null;
      pages++;
    }

    return results;
  }
}

/** Parse a GitHub Link header and return the URL for rel="next" (or null). */
function parseNextLink(linkHeader: string): string | null {
  const links = linkHeader.split(",").map((s) => s.trim());
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1]!;
  }
  return null;
}

async function throwOnError(
  response: Response,
  logger?: GitHubClientLogger,
): Promise<never> {
  const body = await response
    .json()
    .catch(() => ({ message: "Unknown error" })) as { message?: string };

  if (response.status === 429 || response.status === 403) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    if (remaining === "0" && reset) {
      throw new GitHubRateLimitError(
        body.message || "GitHub rate limit exceeded",
        response.status,
        new Date(parseInt(reset) * 1000),
        0,
      );
    }
  }

  logger?.error("GitHub API error", {
    status: response.status,
    message: body.message,
    url: response.url,
  });

  throw new GitHubApiError(
    body.message || `HTTP ${response.status}`,
    response.status,
    body,
    response.status >= 500 || response.status === 429,
  );
}
