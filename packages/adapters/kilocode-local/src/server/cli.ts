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
import { DEFAULT_KILOCODE_EXECUTABLE, DEFAULT_KILOCODE_TIMEOUT_SEC } from "../index.js";

const SAFE_BASE_ENV = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM"];
const ALLOWED_ENV_KEY = /^(KILO_|KILOCODE_|NO_COLOR$|FORCE_COLOR$|PATH$|HOME$|USER$|LOGNAME$|TMPDIR$|TMP$|TEMP$|LANG$|LC_ALL$|TERM$)/;

export interface KilocodePreparedCommand {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutSec: number;
  prompt: string;
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

export function parseStringArrayJson(raw: unknown, field: string): string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new Error(`${field} must be a JSON array of strings.`);
  }
  return parsed;
}

export function parseKilocodeEnv(raw: unknown): Record<string, string> {
  const parsed = typeof raw === "string" ? parseJsonObject(raw, "env") : parseObject(raw);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!ALLOWED_ENV_KEY.test(key)) {
      throw new Error(`Environment variable ${key} is not allowed for kilocode_local.`);
    }
    if (value === undefined || value === null) continue;
    env[key] = String(value);
  }
  return env;
}

export function buildKilocodeEnv(config: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_BASE_ENV) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }

  Object.assign(env, parseKilocodeEnv(config.env));

  const provider = asString(config.provider, "").trim();
  if (provider) env.KILO_PROVIDER = provider;

  const model = asString(config.model, "").trim();
  if (model) {
    if ((env.KILO_PROVIDER || provider) === "kilocode") env.KILOCODE_MODEL = model;
    else env.KILO_MODEL = model;
  }

  const orgId = asString(config.organizationId, "").trim();
  if (orgId) env.KILO_ORG_ID = orgId;

  const agentMode = asString(config.agentMode, "").trim();
  if (agentMode) env.KILO_AGENT_MODE = agentMode;

  return env;
}

export async function prepareKilocodeCommand(ctx: AdapterExecutionContext): Promise<KilocodePreparedCommand> {
  const config = parseObject(ctx.config);
  const executable = asString(config.executablePath, DEFAULT_KILOCODE_EXECUTABLE).trim() || DEFAULT_KILOCODE_EXECUTABLE;
  const workspaceContext = parseObject(ctx.context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "").trim();
  const configuredCwd = asString(config.cwd, "").trim();
  const cwd = path.resolve(workspaceCwd || configuredCwd || process.cwd());
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const promptTemplate = asString(config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE);
  const prompt = renderTemplate(promptTemplate, {
    agent: ctx.agent,
    runtime: ctx.runtime,
    context: ctx.context,
    runId: ctx.runId,
  });

  const extraArgs = parseStringArrayJson(config.extraArgs, "extraArgs");
  const args = ["run", "--auto", ...extraArgs, prompt];
  const env = buildKilocodeEnv(config);
  const timeoutSec = Math.max(1, asNumber(config.timeoutSec, DEFAULT_KILOCODE_TIMEOUT_SEC));

  await ensureCommandResolvable(executable, cwd, env);

  return { executable, args, cwd, env, timeoutSec, prompt };
}