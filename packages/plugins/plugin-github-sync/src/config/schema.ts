/**
 * Configuration schema for the GitHub Sync plugin.
 *
 * Two representations:
 *
 *   - `instanceConfigJsonSchema`: a JSON Schema (Draft 7-ish, the subset
 *     understood by Paperclip's settings UI) that the host renders into
 *     the settings page form. The host validates inbound config against
 *     this schema before storing it in `plugin_config`.
 *
 *   - `instanceConfigZodSchema`: a Zod schema the worker uses at runtime
 *     to parse the resolved config into a strongly-typed object. This
 *     also enforces cross-field rules the JSON Schema cannot express
 *     (e.g. "in prod mode, PAT is rejected unless allowPatInProd is on").
 *
 * Both must stay in sync. The shape is authoritative for what operators
 * see in the UI and what the worker can rely on at runtime.
 *
 * Secrets are never stored inline. The user provides Paperclip secret
 * refs (resolved at runtime via `ctx.secrets.resolve`) for the App
 * private key, webhook secret, and PAT.
 */
import { z } from "@paperclipai/plugin-sdk";
import type { JsonSchema } from "@paperclipai/plugin-sdk";
import { DEFAULT_PROTECTED_BRANCHES, SYNC_MODES } from "../constants.js";

// ---------------------------------------------------------------------------
// JSON Schema — what the host's settings UI consumes.
// ---------------------------------------------------------------------------

export const instanceConfigJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    syncMode: {
      type: "string",
      enum: [...SYNC_MODES],
      title: "Sync Mode",
      description:
        "`prod` uses GitHub App authentication (required for production). `dev` permits a personal access token for local development only.",
      default: "dev",
    },
    appId: {
      type: "string",
      title: "GitHub App ID",
      description:
        "Numeric App ID from the GitHub App settings page. Required when syncMode is `prod`.",
    },
    installationId: {
      type: "string",
      title: "GitHub App Installation ID",
      description:
        "Numeric installation ID for the org/user the App is installed on. Required when syncMode is `prod`.",
    },
    privateKeySecretRef: {
      type: "string",
      title: "Private Key Secret Reference",
      description:
        "Paperclip secret ref (e.g. `secret://company/github-app-private-key`) resolving to a PEM-encoded RSA private key. Required when syncMode is `prod`.",
    },
    webhookSecretRef: {
      type: "string",
      title: "Webhook Secret Reference",
      description:
        "Paperclip secret ref resolving to the shared webhook secret used to verify X-Hub-Signature-256. Required in all modes.",
    },
    patSecretRef: {
      type: "string",
      title: "Personal Access Token Secret Reference (dev only)",
      description:
        "Paperclip secret ref resolving to a fine-grained GitHub PAT. Only honoured when syncMode is `dev` (or in `prod` with `allowPatInProd: true`).",
    },
    allowPatInProd: {
      type: "boolean",
      title: "Allow PAT in production",
      description:
        "Explicit opt-in to allow PAT authentication when syncMode is `prod`. Defaults to false because PAT belongs in dev only.",
      default: false,
    },
    protectedBranches: {
      type: "array",
      title: "Protected Branches",
      description:
        "Glob patterns whose branches must never be the target of outbound writes (commits, comments-on-PRs targeting that base, etc.).",
      items: { type: "string" },
      default: [...DEFAULT_PROTECTED_BRANCHES],
    },
    autoCreateTickets: {
      type: "boolean",
      title: "Auto-create Paperclip tickets from GitHub issues",
      description:
        "When false (default), GitHub issues populate the mirror tables but do not auto-create Paperclip tickets. Manual promotion only.",
      default: false,
    },
    mirrorLabels: {
      type: "boolean",
      title: "Mirror GitHub labels into Paperclip labels",
      description:
        "When true, label changes on GitHub propagate to the Paperclip `labels` table for linked tickets. Default false.",
      default: false,
    },
    allowAuthoritativeWrites: {
      type: "boolean",
      title: "Allow authoritative writes back to GitHub",
      description:
        "When true, Paperclip changes may push back to GitHub (issue titles, bodies, close state) via explicit tool calls. Default false — read-only mirror.",
      default: false,
    },
    autoCloseOnExternalClose: {
      type: "boolean",
      title: "Auto-close Paperclip ticket when linked GitHub issue closes",
      description:
        "When true, closing a linked GitHub issue closes the Paperclip ticket. Default false — Paperclip remains the authority over ticket lifecycle.",
      default: false,
    },
  },
  required: ["syncMode", "webhookSecretRef"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Zod schema — what the worker uses at runtime.
// ---------------------------------------------------------------------------

const baseSchema = z.object({
  syncMode: z.enum(SYNC_MODES),
  appId: z.string().min(1).optional(),
  installationId: z.string().min(1).optional(),
  privateKeySecretRef: z.string().min(1).optional(),
  webhookSecretRef: z.string().min(1),
  patSecretRef: z.string().min(1).optional(),
  allowPatInProd: z.boolean().default(false),
  protectedBranches: z.array(z.string().min(1)).default([...DEFAULT_PROTECTED_BRANCHES]),
  autoCreateTickets: z.boolean().default(false),
  mirrorLabels: z.boolean().default(false),
  allowAuthoritativeWrites: z.boolean().default(false),
  autoCloseOnExternalClose: z.boolean().default(false),
});

/**
 * Full Zod schema with cross-field rules.
 *
 * Rules enforced:
 *   1. `prod` mode requires appId, installationId, and privateKeySecretRef.
 *   2. `prod` mode + patSecretRef requires explicit `allowPatInProd: true`.
 *   3. `dev` mode requires either a PAT or full App credentials.
 *
 * The error messages are operator-facing — keep them concrete and
 * actionable. They show up directly in the settings UI when validation
 * fails.
 */
export const instanceConfigZodSchema = baseSchema.superRefine((cfg, ctx) => {
  if (cfg.syncMode === "prod") {
    const missing: string[] = [];
    if (!cfg.appId) missing.push("appId");
    if (!cfg.installationId) missing.push("installationId");
    if (!cfg.privateKeySecretRef) missing.push("privateKeySecretRef");
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `syncMode=prod requires GitHub App credentials. Missing: ${missing.join(", ")}.`,
        path: [missing[0]!],
      });
    }
    if (cfg.patSecretRef && !cfg.allowPatInProd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "patSecretRef is set in prod mode without allowPatInProd=true. PAT is a dev fallback only; enable allowPatInProd explicitly to use it in prod.",
        path: ["patSecretRef"],
      });
    }
  } else {
    // dev mode
    const hasPat = Boolean(cfg.patSecretRef);
    const hasApp = Boolean(cfg.appId && cfg.installationId && cfg.privateKeySecretRef);
    if (!hasPat && !hasApp) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "syncMode=dev requires either patSecretRef OR full App credentials (appId + installationId + privateKeySecretRef).",
        path: ["patSecretRef"],
      });
    }
  }
});

export type GitHubSyncConfig = z.infer<typeof baseSchema>;
