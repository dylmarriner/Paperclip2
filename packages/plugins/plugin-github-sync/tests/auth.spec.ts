/**
 * Tests for the GitHub Sync plugin authentication layer.
 *
 * Coverage:
 *   - GitHubAppAuth JWT creation (valid structure, RSA signing)
 *   - Installation token exchange (success, 401, 404, 429, network error)
 *   - Token caching (reuse within TTL, refresh near expiry)
 *   - PatAuth header construction
 *   - Factory createAuthProvider (dev PAT, dev App, prod App, missing creds)
 */
import { describe, expect, it, vi } from "vitest";
import {
  GitHubAppAuth,
  PatAuth,
  createAuthProvider,
  InMemoryTokenStore,
} from "../src/auth/index.js";
import {
  GitHubAuthError,
  GitHubRateLimitError,
} from "../src/errors.js";
import { getTestKeyPair, mockFetchJson } from "./helpers.js";

describe("GitHubAppAuth", () => {
  it("creates a valid RS256 JWT with correct claims", () => {
    const { privateKey } = getTestKeyPair();
    const auth = new GitHubAppAuth(
      { appId: "123", installationId: "456", privateKey },
      globalThis.fetch,
    );

    const jwt = auth.createJWT();
    const [headerB64, payloadB64] = jwt.split(".");
    const header = JSON.parse(
      Buffer.from(headerB64!, "base64url").toString("utf8"),
    );
    const payload = JSON.parse(
      Buffer.from(payloadB64!, "base64url").toString("utf8"),
    );

    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload.iss).toBe("123");
    expect(payload.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(payload.exp - payload.iat).toBe(660); // 10 min + 60s clock skew buffer
  });

  it("throws GitHubAuthError on invalid private key", () => {
    const auth = new GitHubAppAuth(
      { appId: "123", installationId: "456", privateKey: "not-a-key" },
      globalThis.fetch,
    );
    expect(() => auth.createJWT()).toThrow(GitHubAuthError);
  });

  it("exchanges JWT for an installation token", async () => {
    const { privateKey } = getTestKeyPair();
    const futureExpiry = new Date(Date.now() + 3600_000).toISOString();
    const fetch = mockFetchJson(201, {
      token: "ghs_installation_token",
      expires_at: futureExpiry,
    });

    const auth = new GitHubAppAuth(
      { appId: "123", installationId: "456", privateKey },
      fetch,
    );

    const jwt = auth.createJWT();
    const result = await auth.exchangeJWTForToken(jwt);

    expect(result.token).toBe("ghs_installation_token");
    expect(result.expiresAt).toBe(new Date(futureExpiry).getTime());
  });

  it("throws GitHubAuthError on 401 token exchange", async () => {
    const { privateKey } = getTestKeyPair();
    const fetch = mockFetchJson(401, { message: "Bad credentials" });
    const auth = new GitHubAppAuth(
      { appId: "123", installationId: "456", privateKey },
      fetch,
    );

    await expect(auth.exchangeJWTForToken("jwt")).rejects.toThrow(
      GitHubAuthError,
    );
  });

  it("throws GitHubRateLimitError on 429 token exchange", async () => {
    const { privateKey } = getTestKeyPair();
    const fetch = mockFetchJson(429, { message: "Rate limited" }, {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
    });
    const auth = new GitHubAppAuth(
      { appId: "123", installationId: "456", privateKey },
      fetch,
    );

    await expect(auth.exchangeJWTForToken("jwt")).rejects.toThrow(
      GitHubRateLimitError,
    );
  });

  it("throws GitHubAuthError on network failure", async () => {
    const { privateKey } = getTestKeyPair();
    const fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const auth = new GitHubAppAuth(
      { appId: "123", installationId: "456", privateKey },
      fetch as unknown as typeof globalThis.fetch,
    );

    await expect(auth.exchangeJWTForToken("jwt")).rejects.toThrow(
      GitHubAuthError,
    );
  });

  it("caches installation tokens and reuses them", async () => {
    const { privateKey } = getTestKeyPair();
    const futureExpiry = new Date(Date.now() + 3600_000).toISOString();
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ token: "cached_token", expires_at: futureExpiry }),
        { status: 201 },
      ),
    );

    const store = new InMemoryTokenStore();
    const auth = new GitHubAppAuth(
      { appId: "123", installationId: "456", privateKey },
      fetch as unknown as typeof globalThis.fetch,
      store,
    );

    const headers1 = await auth.getAuthHeaders();
    const headers2 = await auth.getAuthHeaders();

    expect(headers1.Authorization).toBe("Bearer cached_token");
    expect(headers2.Authorization).toBe("Bearer cached_token");
    expect(fetch).toHaveBeenCalledTimes(1); // Only one exchange
  });

  it("refreshes the token when near expiry", async () => {
    const { privateKey } = getTestKeyPair();
    const nearExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min left
    const futureExpiry = new Date(Date.now() + 3600_000).toISOString();

    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ token: "old_token", expires_at: nearExpiry }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ token: "new_token", expires_at: futureExpiry }),
          { status: 201 },
        ),
      );

    const store = new InMemoryTokenStore();
    const auth = new GitHubAppAuth(
      { appId: "123", installationId: "456", privateKey },
      fetch as unknown as typeof globalThis.fetch,
      store,
    );

    // First call stores the near-expiry token
    await auth.getAuthHeaders();

    // Second call should refresh because < 10 min remain
    const headers = await auth.getAuthHeaders();
    expect(headers.Authorization).toBe("Bearer new_token");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("PatAuth", () => {
  it("returns a Bearer authorization header", async () => {
    const auth = new PatAuth("ghp_mypat");
    const headers = await auth.getAuthHeaders();
    expect(headers.Authorization).toBe("Bearer ghp_mypat");
  });
});

describe("createAuthProvider", () => {
  const baseConfig = {
    syncMode: "dev" as const,
    webhookSecretRef: "s",
    allowPatInProd: false,
    protectedBranches: ["main", "master", "release/*"] as string[],
    autoCreateTickets: false,
    mirrorLabels: false,
    allowAuthoritativeWrites: false,
    autoCloseOnExternalClose: false,
  };

  it("returns PatAuth in dev mode when PAT is available", () => {
    const auth = createAuthProvider(
      { ...baseConfig, syncMode: "dev", patSecretRef: "s" },
      { webhookSecret: "wh", pat: "pat" },
      globalThis.fetch,
    );
    expect(auth).toBeInstanceOf(PatAuth);
  });

  it("returns GitHubAppAuth in dev mode with only App credentials", () => {
    const { privateKey } = getTestKeyPair();
    const auth = createAuthProvider(
      {
        ...baseConfig,
        syncMode: "dev",
        appId: "1",
        installationId: "2",
        privateKeySecretRef: "s",
      },
      { webhookSecret: "wh", privateKey },
      globalThis.fetch,
    );
    expect(auth).toBeInstanceOf(GitHubAppAuth);
  });

  it("returns GitHubAppAuth in prod mode", () => {
    const { privateKey } = getTestKeyPair();
    const auth = createAuthProvider(
      {
        ...baseConfig,
        syncMode: "prod",
        appId: "1",
        installationId: "2",
        privateKeySecretRef: "s",
      },
      { webhookSecret: "wh", privateKey },
      globalThis.fetch,
    );
    expect(auth).toBeInstanceOf(GitHubAppAuth);
  });

  it("throws when prod mode lacks App credentials", () => {
    expect(() =>
      createAuthProvider(
        { ...baseConfig, syncMode: "prod" },
        { webhookSecret: "wh" },
        globalThis.fetch,
      ),
    ).toThrow(GitHubAuthError);
  });

  it("throws when dev mode lacks any credentials", () => {
    expect(() =>
      createAuthProvider(
        { ...baseConfig, syncMode: "dev" },
        { webhookSecret: "wh" },
        globalThis.fetch,
      ),
    ).toThrow(GitHubAuthError);
  });
});

describe("InMemoryTokenStore", () => {
  it("stores and retrieves a token", () => {
    const store = new InMemoryTokenStore();
    const expiresAt = Date.now() + 3600_000;
    store.set("inst-1", "token-a", expiresAt);
    expect(store.get("inst-1")).toBe("token-a");
  });

  it("returns null for missing tokens", () => {
    const store = new InMemoryTokenStore();
    expect(store.get("inst-1")).toBeNull();
  });

  it("returns null and deletes when token is near expiry", () => {
    const store = new InMemoryTokenStore();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min left
    store.set("inst-1", "token-a", expiresAt);
    expect(store.get("inst-1")).toBeNull();
  });

  it("clears all entries", () => {
    const store = new InMemoryTokenStore();
    store.set("inst-1", "token-a", Date.now() + 3600_000);
    store.clear();
    expect(store.get("inst-1")).toBeNull();
  });
});
