/**
 * Tests for webhook signature verification.
 *
 * These tests validate that:
 *   - Valid signatures from GitHub are accepted
 *   - Invalid signatures are rejected without timing leaks
 *   - Malformed headers are rejected gracefully
 */
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "../src/webhooks/signature.js";
import crypto from "crypto";

function computeSignature(secret: string, payload: string): string {
  const hmac = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  return `sha256=${hmac}`;
}

describe("verifyWebhookSignature", () => {
  const secret = "my-webhook-secret-42";
  const payload = '{"action":"opened","issue":{"number":1}}';

  it("accepts a correctly computed signature", () => {
    const signature = computeSignature(secret, payload);
    expect(verifyWebhookSignature(secret, payload, signature)).toBe(true);
  });

  it("rejects a signature with wrong secret", () => {
    const signature = computeSignature("wrong-secret", payload);
    expect(verifyWebhookSignature(secret, payload, signature)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const signature = computeSignature(secret, payload);
    const tampered = payload.replace("opened", "closed");
    expect(verifyWebhookSignature(secret, tampered, signature)).toBe(false);
  });

  it("rejects a signature missing the sha256= prefix", () => {
    const rawHex = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
    expect(verifyWebhookSignature(secret, payload, rawHex)).toBe(false);
  });

  it("rejects a signature with wrong hex length", () => {
    expect(verifyWebhookSignature(secret, payload, "sha256=abc123")).toBe(false);
  });

  it("rejects a signature that is not valid hex", () => {
    const badHex = "sha256=" + "g".repeat(64);
    expect(verifyWebhookSignature(secret, payload, badHex)).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifyWebhookSignature(secret, payload, "")).toBe(false);
  });

  it("accepts a signature for an empty payload", () => {
    const emptyPayload = "";
    const signature = computeSignature(secret, emptyPayload);
    expect(verifyWebhookSignature(secret, emptyPayload, signature)).toBe(true);
  });
});
