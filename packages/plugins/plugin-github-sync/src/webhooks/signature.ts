/**
 * GitHub webhook signature verification.
 *
 * GitHub signs webhook payloads with HMAC-SHA256 using the shared
 * webhook secret. The signature is delivered in the
 * `X-Hub-Signature-256` header as `sha256=<hex>`.
 *
 * We verify using Node.js `crypto.timingSafeEqual` on the raw byte
 * buffers to prevent timing attacks. If the provided signature is
 * malformed (wrong length, not hex, missing prefix) we return false
 * without throwing — the caller should reject the delivery.
 *
 * Failure modes:
 *   - Missing or malformed signature header → false
 *   - Signature length mismatch → false (no timing leak)
 *   - Signature content mismatch → false (timing-safe comparison)
 */
import crypto from "crypto";

/**
 * Verify a GitHub webhook payload signature.
 *
 * @param secret   - The shared webhook secret (resolved from config)
 * @param payload  - Raw request body as a UTF-8 string
 * @param signature - Value of the `X-Hub-Signature-256` header
 * @returns true if the signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
): boolean {
  if (!signature.startsWith("sha256=")) {
    return false;
  }

  const providedHex = signature.slice(7); // Remove "sha256=" prefix
  const providedBuf = Buffer.from(providedHex, "hex");

  // SHA-256 produces 32 bytes. A malformed hex string or wrong length
  // should not reach timingSafeEqual.
  if (providedBuf.length !== 32) {
    return false;
  }

  const expectedBuf = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest();

  try {
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    // timingSafeEqual throws when buffer lengths differ.
    // We already checked lengths above, but defense in depth.
    return false;
  }
}
