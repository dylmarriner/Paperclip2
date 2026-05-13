import path from "node:path";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  parseObject,
  renderTemplate,
} from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_KIRO_EXECUTABLE, DEFAULT_KIRO_TIMEOUT_SEC } from "../index.js";

const SAFE_BASE_ENV = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM"];
const ALLOWED_ENV_KEY = /^(KIRO_|NO_COLOR$|FORCE_COLOR$|PATH$|HOME$|USER$|LOGNAME$|TMPDIR$|TMP$|TEMP$|LANG$|LC_ALL$|TERM$)/;

export type KiroMode = "auto" | "acp" | "command";

export interface KiroPreparedExecution {
  executable: string;
  cwd: string;
  env: Record<string, string>;
  prompt: string;
  timeoutSec: number;
  config: Record<string, unknown>;
  mode: KiroMode;
}

export function parseJsonObject(raw: string, field: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${field} must be a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === `${field} must be a JSON object.`) throw error;
    throw new Error(`${field} must be valid JSON.`);
  }
}

export function parseKiroEnv(raw: unknown): Record<string, string> {
  const parsed = typeof raw === "string" ? parseJsonObject(raw, "env") : parseObject(raw);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!ALLOWED_ENV_KEY.test(key)) throw new Error(`Environment variable ${key} is not allowed for kiro_cli.`);
    if (value !== undefined && value !== null) out[key] = String(value);
  }
  return out;
}

export function buildKiroEnv(config: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_BASE_ENV) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  return { ...env, ...parseKiroEnv(config.env) };
}

export function normalizeMode(value: unknown): KiroMode {
  return value === "acp" || value === "command" || value === "auto" ? value : "auto";
}

export function parseStringArrayJson(raw: unknown, field: string): string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) throw new Error(`${field} must be a JSON array of strings.`);
  return parsed;
}

export function redactEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, /(key|token|secret|password|passwd|authorization|cookie)/i.test(key) ? "***REDACTED***" : value]));
}

export async function prepareKiroExecution(ctx: AdapterExecutionContext): Promise<KiroPreparedExecution> {
  const config = parseObject(ctx.config);
  const executable = asString(config.executablePath, DEFAULT_KIRO_EXECUTABLE).trim() || DEFAULT_KIRO_EXECUTABLE;
  const workspaceContext = parseObject(ctx.context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "").trim();
  const configuredCwd = asString(config.cwd, "").trim();
  const cwd = path.resolve(workspaceCwd || configuredCwd || process.cwd());
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const env = buildKiroEnv(config);
  await ensureCommandResolvable(executable, cwd, env);

  const prompt = renderTemplate(asString(config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE), {
    agent: ctx.agent,
    runtime: ctx.runtime,
    context: ctx.context,
    runId: ctx.runId,
  });

  return {
    executable,
    cwd,
    env,
    prompt,
    timeoutSec: Math.max(1, asNumber(config.timeoutSec, DEFAULT_KIRO_TIMEOUT_SEC)),
    config,
    mode: normalizeMode(config.integrationMode),
  };
}