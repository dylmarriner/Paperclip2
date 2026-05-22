/**
 * Tests for pagination utilities.
 *
 * Coverage:
 *   - fetchPaginated handles Link header parsing
 *   - fetchPaginated respects per_page limit
 *   - fetchPaginated accumulates results across pages
 *   - fetchPaginated stops when no Link header (single page)
 */
import { describe, expect, it, vi } from "vitest";
import { fetchPaginated } from "../src/sync/pagination.js";

describe("fetchPaginated", () => {
  it("handles single page response without Link header", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => [{ id: 1 }, { id: 2 }],
    });

    const results = await fetchPaginated(
      fetch,
      "https://api.github.com/repos/o/r/issues?per_page=100",
    );

    expect(results.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(results.etag).toBeNull();
    expect(results.nextUrl).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("handles multi-page response with Link header", async () => {
    let callCount = 0;
    const fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          headers: new Headers({
            Link: '<https://api.github.com/repos/o/r/issues?page=2&per_page=100>; rel="next"',
          }),
          json: async () => [{ id: 1 }, { id: 2 }],
        };
      } else {
        return {
          ok: true,
          headers: new Headers(),
          json: async () => [{ id: 3 }],
        };
      }
    });

    const results = await fetchPaginated(
      fetch,
      "https://api.github.com/repos/o/r/issues?per_page=100",
    );

    expect(results.items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(results.etag).toBeNull();
    expect(results.nextUrl).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("passes query parameters to fetch", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => [],
    });

    await fetchPaginated(
      fetch,
      "https://api.github.com/repos/o/r/issues?state=open&per_page=50",
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/issues?state=open&per_page=50",
      undefined,
    );
  });

  it("handles fetch errors", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    await expect(
      fetchPaginated(
        fetch,
        "https://api.github.com/repos/o/r/issues?per_page=100",
      ),
    ).rejects.toThrow("Network error");
  });
});
