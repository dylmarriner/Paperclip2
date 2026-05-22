/**
 * Tests for SSRF guard.
 */
import { describe, it, expect } from "vitest";
import { validateUrl, validateGitHubPath, SSRFError } from "../src/http/ssrf-guard.js";

describe("ssrf-guard", () => {
  describe("validateUrl", () => {
    it("accepts valid GitHub API URLs", () => {
      expect(() => validateUrl("https://api.github.com/repos/owner/repo")).not.toThrow();
      expect(() => validateUrl("https://github.com/owner/repo")).not.toThrow();
    });

    it("rejects non-HTTPS URLs", () => {
      expect(() => validateUrl("http://api.github.com/repos/owner/repo")).toThrow(SSRFError);
      expect(() => validateUrl("ftp://api.github.com/repos/owner/repo")).toThrow(SSRFError);
    });

    it("rejects non-GitHub hosts", () => {
      expect(() => validateUrl("https://example.com/repos/owner/repo")).toThrow(SSRFError);
      expect(() => validateUrl("https://evil.com")).toThrow(SSRFError);
    });

    it("rejects URLs with credentials", () => {
      expect(() => validateUrl("https://user:pass@api.github.com/repos/owner/repo")).toThrow(SSRFError);
    });

    it("rejects URLs with non-standard ports", () => {
      expect(() => validateUrl("https://api.github.com:8080/repos/owner/repo")).toThrow(SSRFError);
    });

    it("rejects malformed URLs", () => {
      expect(() => validateUrl("not-a-url")).toThrow(SSRFError);
    });
  });

  describe("validateGitHubPath", () => {
    it("accepts valid owner/repo paths", () => {
      expect(() => validateGitHubPath("owner/repo")).not.toThrow();
      expect(() => validateGitHubPath("my-org/my-repo")).not.toThrow();
      expect(() => validateGitHubPath("user123/repo_456")).not.toThrow();
    });

    it("accepts paths with additional segments", () => {
      expect(() => validateGitHubPath("owner/repo/path/to/file")).not.toThrow();
    });

    it("rejects paths with insufficient segments", () => {
      expect(() => validateGitHubPath("owner")).toThrow("Invalid GitHub path");
      expect(() => validateGitHubPath("")).toThrow("Invalid GitHub path");
    });

    it("rejects invalid characters in owner", () => {
      expect(() => validateGitHubPath("owner@/repo")).toThrow("Invalid GitHub owner");
      expect(() => validateGitHubPath("owner with spaces/repo")).toThrow("Invalid GitHub owner");
    });

    it("rejects invalid characters in repo", () => {
      expect(() => validateGitHubPath("owner/repo@")).toThrow("Invalid GitHub repo");
      expect(() => validateGitHubPath("owner/repo with spaces")).toThrow("Invalid GitHub repo");
    });
  });
});
