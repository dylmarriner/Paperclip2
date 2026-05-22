/**
 * Tests for structured error classification.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorCategory,
  createAuthError,
  createAuthzError,
  createRateLimitError,
  createNetworkError,
  createNotFoundError,
  createValidationError,
  createSSRFError,
  createUnknownError,
  toStructuredError,
  GitHubSyncError,
} from "../src/errors/structured.js";

describe("structured-errors", () => {
  describe("createAuthError", () => {
    it("creates an authentication error", () => {
      const err = createAuthError("Invalid token");
      expect(err).toBeInstanceOf(GitHubSyncError);
      expect(err.structured.category).toBe(ErrorCategory.AUTHENTICATION);
      expect(err.structured.code).toBe("AUTH_FAILED");
      expect(err.structured.userMessage).toContain("authentication failed");
    });
  });

  describe("createAuthzError", () => {
    it("creates an authorization error", () => {
      const err = createAuthzError("Permission denied");
      expect(err).toBeInstanceOf(GitHubSyncError);
      expect(err.structured.category).toBe(ErrorCategory.AUTHORIZATION);
      expect(err.structured.code).toBe("AUTHZ_FAILED");
      expect(err.structured.userMessage).toContain("authorization failed");
    });
  });

  describe("createRateLimitError", () => {
    it("creates a rate limit error", () => {
      const resetAt = new Date(1716336000000);
      const err = createRateLimitError(5, resetAt);
      expect(err).toBeInstanceOf(GitHubSyncError);
      expect(err.structured.category).toBe(ErrorCategory.RATE_LIMIT);
      expect(err.structured.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(err.structured.userMessage).toContain("rate limit exceeded");
      expect(err.structured.context?.remaining).toBe(5);
    });
  });

  describe("createNetworkError", () => {
    it("creates a network error", () => {
      const err = createNetworkError("Connection refused");
      expect(err).toBeInstanceOf(GitHubSyncError);
      expect(err.structured.category).toBe(ErrorCategory.NETWORK);
      expect(err.structured.code).toBe("NETWORK_ERROR");
      expect(err.structured.userMessage).toContain("Network error");
    });
  });

  describe("createNotFoundError", () => {
    it("creates a not found error", () => {
      const err = createNotFoundError("owner/repo");
      expect(err).toBeInstanceOf(GitHubSyncError);
      expect(err.structured.category).toBe(ErrorCategory.NOT_FOUND);
      expect(err.structured.code).toBe("NOT_FOUND");
      expect(err.structured.userMessage).toContain("not found");
      expect(err.structured.context?.resource).toBe("owner/repo");
    });
  });

  describe("createValidationError", () => {
    it("creates a validation error", () => {
      const err = createValidationError("repo", "Invalid characters");
      expect(err).toBeInstanceOf(GitHubSyncError);
      expect(err.structured.category).toBe(ErrorCategory.VALIDATION);
      expect(err.structured.code).toBe("VALIDATION_ERROR");
      expect(err.structured.userMessage).toContain("Invalid input");
      expect(err.structured.context?.field).toBe("repo");
    });
  });

  describe("createSSRFError", () => {
    it("creates an SSRF error", () => {
      const err = createSSRFError("https://evil.com");
      expect(err).toBeInstanceOf(GitHubSyncError);
      expect(err.structured.category).toBe(ErrorCategory.SSRF);
      expect(err.structured.code).toBe("SSRF_REJECTED");
      expect(err.structured.userMessage).toContain("Invalid GitHub URL");
      expect(err.structured.context?.url).toBe("https://evil.com");
    });
  });

  describe("createUnknownError", () => {
    it("creates an unknown error", () => {
      const err = createUnknownError("Something went wrong");
      expect(err).toBeInstanceOf(GitHubSyncError);
      expect(err.structured.category).toBe(ErrorCategory.UNKNOWN);
      expect(err.structured.code).toBe("UNKNOWN_ERROR");
      expect(err.structured.userMessage).toContain("unexpected error");
    });
  });

  describe("toStructuredError", () => {
    it("returns GitHubSyncError as-is", () => {
      const original = createAuthError("test");
      const converted = toStructuredError(original);
      expect(converted).toBe(original);
    });

    it("converts generic Error to GitHubSyncError", () => {
      const err = new Error("Generic error");
      const converted = toStructuredError(err);
      expect(converted).toBeInstanceOf(GitHubSyncError);
      expect(converted.structured.category).toBe(ErrorCategory.UNKNOWN);
      expect(converted.structured.technicalMessage).toBe("Generic error");
    });

    it("converts string to GitHubSyncError", () => {
      const converted = toStructuredError("String error");
      expect(converted).toBeInstanceOf(GitHubSyncError);
      expect(converted.structured.category).toBe(ErrorCategory.UNKNOWN);
      expect(converted.structured.technicalMessage).toBe("String error");
    });
  });
});
