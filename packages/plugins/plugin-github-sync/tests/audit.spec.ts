/**
 * Tests for outbound-write audit envelope.
 */
import { describe, it, expect } from "vitest";
import { redactHeaders, generateAuditId } from "../src/audit/outbound-writes.js";

describe("outbound-writes", () => {
  describe("generateAuditId", () => {
    it("generates a UUID", () => {
      const id = generateAuditId();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("generates unique IDs", () => {
      const id1 = generateAuditId();
      const id2 = generateAuditId();
      expect(id1).not.toBe(id2);
    });
  });

  describe("redactHeaders", () => {
    it("redacts authorization header", () => {
      const headers = new Headers({
        authorization: "Bearer secret-token",
        "x-custom": "value",
      });
      const redacted = redactHeaders(headers);
      const parsed = JSON.parse(redacted);
      expect(parsed.authorization).toBe("***REDACTED***");
      expect(parsed["x-custom"]).toBe("value");
    });

    it("redacts signature header", () => {
      const headers = new Headers({
        "x-hub-signature-256": "sha256=secret",
        "content-type": "application/json",
      });
      const redacted = redactHeaders(headers);
      const parsed = JSON.parse(redacted);
      expect(parsed["x-hub-signature-256"]).toBe("***REDACTED***");
      expect(parsed["content-type"]).toBe("application/json");
    });

    it("redacts cookie headers", () => {
      const headers = new Headers({
        cookie: "session=abc123",
        "set-cookie": "session=xyz789",
        "content-type": "application/json",
      });
      const redacted = redactHeaders(headers);
      const parsed = JSON.parse(redacted);
      expect(parsed.cookie).toBe("***REDACTED***");
      expect(parsed["set-cookie"]).toBe("***REDACTED***");
      expect(parsed["content-type"]).toBe("application/json");
    });

    it("redacts token-related headers", () => {
      const headers = new Headers({
        "x-auth-token": "secret",
        "api-key": "key123",
        "content-type": "application/json",
      });
      const redacted = redactHeaders(headers);
      const parsed = JSON.parse(redacted);
      expect(parsed["x-auth-token"]).toBe("***REDACTED***");
      expect(parsed["api-key"]).toBe("***REDACTED***");
      expect(parsed["content-type"]).toBe("application/json");
    });

    it("redacts secret and private headers", () => {
      const headers = new Headers({
        "x-secret": "secret-value",
        "x-private": "private-value",
        "content-type": "application/json",
      });
      const redacted = redactHeaders(headers);
      const parsed = JSON.parse(redacted);
      expect(parsed["x-secret"]).toBe("***REDACTED***");
      expect(parsed["x-private"]).toBe("***REDACTED***");
      expect(parsed["content-type"]).toBe("application/json");
    });

    it("handles empty headers", () => {
      const redacted = redactHeaders(new Headers());
      const parsed = JSON.parse(redacted);
      expect(parsed).toEqual({});
    });

    it("handles headers with no sensitive fields", () => {
      const headers = new Headers({
        "content-type": "application/json",
        accept: "application/json",
      });
      const redacted = redactHeaders(headers);
      const parsed = JSON.parse(redacted);
      expect(parsed["content-type"]).toBe("application/json");
      expect(parsed["accept"]).toBe("application/json");
    });
  });
});
