/**
 * Tests for the GitHub Sync plugin config validation surface.
 *
 * These tests exercise the cross-field rules that the JSON Schema alone
 * cannot express:
 *
 *   - `prod` mode requires the full GitHub App credential triple
 *   - `prod` + PAT requires the explicit `allowPatInProd` override
 *   - `dev` mode requires either a PAT or full App credentials
 *   - Valid configs surface non-fatal warnings for risky options
 *
 * The tests also pin the operator-facing error message format. If you
 * change `formatZodIssue` in `config/validate.ts` update these tests so
 * the UI surface stays predictable for users debugging their setup.
 */
import { describe, expect, it } from "vitest";
import { parseConfigOrThrow, validateConfig } from "../src/config/validate.js";

const validProdConfig = {
  syncMode: "prod" as const,
  appId: "1234567",
  installationId: "98765432",
  privateKeySecretRef: "secret://co/github-app-private-key",
  webhookSecretRef: "secret://co/github-webhook-secret",
};

const validDevConfigWithPat = {
  syncMode: "dev" as const,
  webhookSecretRef: "secret://co/github-webhook-secret",
  patSecretRef: "secret://co/github-pat",
};

describe("validateConfig", () => {
  it("accepts a fully-credentialed prod config", () => {
    const result = validateConfig(validProdConfig);
    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("accepts a dev config that supplies only a PAT", () => {
    const result = validateConfig(validDevConfigWithPat);
    expect(result.ok).toBe(true);
  });

  it("accepts a dev config that supplies only App credentials", () => {
    const result = validateConfig({
      syncMode: "dev",
      webhookSecretRef: "secret://co/wh",
      appId: "1",
      installationId: "2",
      privateKeySecretRef: "secret://co/pk",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a prod config missing App credentials", () => {
    const result = validateConfig({
      syncMode: "prod",
      webhookSecretRef: "secret://co/wh",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.join("\n")).toContain("appId");
    expect(result.errors!.join("\n")).toContain("installationId");
    expect(result.errors!.join("\n")).toContain("privateKeySecretRef");
  });

  it("rejects a prod config with PAT but no allowPatInProd override", () => {
    const result = validateConfig({
      ...validProdConfig,
      patSecretRef: "secret://co/pat",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.join("\n")).toContain("allowPatInProd");
  });

  it("accepts a prod config with PAT when allowPatInProd is explicit", () => {
    const result = validateConfig({
      ...validProdConfig,
      patSecretRef: "secret://co/pat",
      allowPatInProd: true,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.join("\n")).toMatch(/PAT/i);
  });

  it("rejects a dev config without any credentials", () => {
    const result = validateConfig({
      syncMode: "dev",
      webhookSecretRef: "secret://co/wh",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.join("\n")).toMatch(/patSecretRef|App credentials/);
  });

  it("rejects a config missing the required webhookSecretRef", () => {
    const result = validateConfig({
      syncMode: "dev",
      patSecretRef: "secret://co/pat",
    });
    expect(result.ok).toBe(false);
    expect(result.errors!.join("\n")).toContain("webhookSecretRef");
  });

  it("rejects an unknown syncMode value", () => {
    const result = validateConfig({
      syncMode: "staging",
      webhookSecretRef: "secret://co/wh",
    });
    expect(result.ok).toBe(false);
    expect(result.errors!.join("\n")).toContain("syncMode");
  });

  it("rejects entirely non-object input", () => {
    expect(validateConfig(null).ok).toBe(false);
    expect(validateConfig("nope").ok).toBe(false);
    expect(validateConfig(42).ok).toBe(false);
  });

  it("warns when allowAuthoritativeWrites is enabled", () => {
    const result = validateConfig({
      ...validProdConfig,
      allowAuthoritativeWrites: true,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings!.join("\n")).toMatch(/authoritativeWrites|push back/i);
  });

  it("warns when autoCreateTickets is enabled", () => {
    const result = validateConfig({
      ...validProdConfig,
      autoCreateTickets: true,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings!.join("\n")).toMatch(/autoCreateTickets|ticket/i);
  });

  it("applies defaults to optional fields", () => {
    const result = validateConfig(validDevConfigWithPat);
    expect(result.ok).toBe(true);
    // The resolved config is not returned from validateConfig, so use
    // parseConfigOrThrow to confirm defaults are populated.
    const parsed = parseConfigOrThrow(validDevConfigWithPat);
    expect(parsed.allowPatInProd).toBe(false);
    expect(parsed.allowAuthoritativeWrites).toBe(false);
    expect(parsed.autoCreateTickets).toBe(false);
    expect(parsed.mirrorLabels).toBe(false);
    expect(parsed.autoCloseOnExternalClose).toBe(false);
    expect(parsed.protectedBranches).toEqual(["main", "master", "release/*"]);
  });
});

describe("parseConfigOrThrow", () => {
  it("returns a typed config for valid input", () => {
    const cfg = parseConfigOrThrow(validProdConfig);
    expect(cfg.syncMode).toBe("prod");
    expect(cfg.appId).toBe("1234567");
    expect(cfg.installationId).toBe("98765432");
  });

  it("throws with a multi-line error for invalid input", () => {
    expect(() =>
      parseConfigOrThrow({
        syncMode: "prod",
        webhookSecretRef: "secret://co/wh",
      }),
    ).toThrowError(/GitHub Sync plugin config is invalid:[\s\S]+appId/);
  });

  it("includes the offending path in every error line", () => {
    let caught: Error | null = null;
    try {
      parseConfigOrThrow({ syncMode: "prod" });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    // Each error line should start with `<path>: ` or `<root>: `
    const lines = caught!.message
      .split("\n")
      .filter((l) => l.startsWith("  - "));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^ {2}- \S+(\.\S+)*: .+/);
    }
  });
});
