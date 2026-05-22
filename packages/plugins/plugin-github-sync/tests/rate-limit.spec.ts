/**
 * Tests for rate-limit handling.
 *
 * Coverage:
 *   - parseRateLimitHeaders extracts limits from response headers
 *   - parseRateLimitHeaders handles missing headers
 *   - waitForRateLimitReset waits until reset time
 *   - waitForRateLimitReset caps wait at 30 seconds
 *   - classifyHttpFailure classifies HTTP errors correctly
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  parseRateLimitHeaders,
  waitForRateLimitReset,
  classifyHttpFailure,
  RateLimitError,
  checkRateLimitBudget,
  setRateLimitBudget,
  getRateLimitBudget,
  RateLimitBudgetExceededError,
} from "../src/sync/rate-limit.js";

describe("parseRateLimitHeaders", () => {
  it("extracts rate limit values from headers", () => {
    const response = {
      headers: new Headers({
        "X-RateLimit-Limit": "5000",
        "X-RateLimit-Remaining": "4999",
        "X-RateLimit-Reset": "1716336000",
        "X-RateLimit-Used": "1",
      }),
    } as Response;

    const result = parseRateLimitHeaders(response);

    expect(result).toEqual({
      limit: 5000,
      remaining: 4999,
      reset: 1716336000,
    });
  });

  it("handles missing headers gracefully", () => {
    const response = {
      headers: new Headers(),
    } as Response;

    const result = parseRateLimitHeaders(response);

    expect(result).toBeNull();
  });

  it("handles partial headers", () => {
    const response = {
      headers: new Headers({
        "X-RateLimit-Limit": "5000",
        "X-RateLimit-Remaining": "4999",
      }),
    } as Response;

    const result = parseRateLimitHeaders(response);

    expect(result).toBeNull();
  });
});

describe("waitForRateLimitReset", () => {
  it("waits until reset time", async () => {
    const now = Math.floor(Date.now() / 1000);
    const reset = now + 1; // 1 second in future

    const start = Date.now();
    await waitForRateLimitReset(reset);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(1500);
  });

  it("returns immediately if reset is in the past", async () => {
    const now = Math.floor(Date.now() / 1000);
    const reset = now - 10; // 10 seconds ago

    const start = Date.now();
    await waitForRateLimitReset(reset);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });

  it("caps wait at 30 seconds", async () => {
    const now = Math.floor(Date.now() / 1000);
    const reset = now + 60; // 60 seconds in future

    const start = Date.now();
    await waitForRateLimitReset(reset);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(30000);
    expect(elapsed).toBeLessThan(31000);
  }, 35000);
});

describe("classifyHttpFailure", () => {
  it("classifies 401 as auth_failed", () => {
    const response = {
      status: 401,
      headers: new Headers({ "X-RateLimit-Remaining": "100" }),
    } as Response;

    const kind = classifyHttpFailure(response);

    expect(kind).toBe("auth_failed");
  });

  it("classifies 403 with remaining=0 as rate_limited", () => {
    const response = {
      status: 403,
      headers: new Headers({ "X-RateLimit-Remaining": "0" }),
    } as Response;

    const kind = classifyHttpFailure(response);

    expect(kind).toBe("rate_limited");
  });

  it("classifies 404 as not_found", () => {
    const response = {
      status: 404,
      headers: new Headers(),
    } as Response;

    const kind = classifyHttpFailure(response);

    expect(kind).toBe("not_found");
  });

  it("classifies 429 as rate_limited", () => {
    const response = {
      status: 429,
      headers: new Headers(),
    } as Response;

    const kind = classifyHttpFailure(response);

    expect(kind).toBe("rate_limited");
  });

  it("classifies 5xx as server", () => {
    const response = {
      status: 500,
      headers: new Headers(),
    } as Response;

    const kind = classifyHttpFailure(response);

    expect(kind).toBe("server");
  });

  it("classifies network errors as network", () => {
    const error = new TypeError("fetch failed");
    const kind = classifyHttpFailure(null as any, error);

    expect(kind).toBe("network");
  });
});

describe("checkRateLimitBudget", () => {
  beforeEach(() => {
    // Reset to default budget before each test
    setRateLimitBudget({ minimumRemaining: 10, warningThreshold: 100 });
  });

  it("allows requests when remaining is above minimum", () => {
    const info = { remaining: 500, reset: 1716336000, limit: 5000 };
    expect(() => checkRateLimitBudget(info)).not.toThrow();
  });

  it("throws when remaining is below minimum", () => {
    const info = { remaining: 5, reset: 1716336000, limit: 5000 };
    expect(() => checkRateLimitBudget(info)).toThrow(RateLimitBudgetExceededError);
  });

  it("throws with correct error message", () => {
    const info = { remaining: 5, reset: 1716336000, limit: 5000 };
    try {
      checkRateLimitBudget(info);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitBudgetExceededError);
      expect((err as RateLimitBudgetExceededError).remaining).toBe(5);
    }
  });

  it("logs warning when remaining is below threshold", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn");
    const info = { remaining: 50, reset: 1716336000, limit: 5000 };
    checkRateLimitBudget(info);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "GitHub API rate limit warning: 50 remaining (threshold: 100)",
    );
    consoleWarnSpy.mockRestore();
  });

  it("does not log warning when remaining is above threshold", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn");
    const info = { remaining: 200, reset: 1716336000, limit: 5000 };
    checkRateLimitBudget(info);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });
});

describe("setRateLimitBudget", () => {
  it("updates the budget configuration", () => {
    setRateLimitBudget({ minimumRemaining: 5, warningThreshold: 50 });
    const budget = getRateLimitBudget();
    expect(budget.minimumRemaining).toBe(5);
    expect(budget.warningThreshold).toBe(50);
  });

  it("partially updates the budget configuration", () => {
    setRateLimitBudget({ minimumRemaining: 20 });
    const budget = getRateLimitBudget();
    expect(budget.minimumRemaining).toBe(20);
    expect(budget.warningThreshold).toBe(100); // unchanged
  });
});
