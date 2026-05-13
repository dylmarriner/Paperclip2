import { createHash } from "node:crypto";
import type { AdapterModel } from "@paperclipai/adapter-utils";
import { asString, ensurePathInEnv, runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_KILOCODE_EXECUTABLE } from "../index.js";

const MODELS_CACHE_TTL_MS = 60_000;
const discoveryCache = new Map<string, { expiresAt: number; models: AdapterModel[] }>();
const VOLATILE_ENV_KEY_PREFIXES = ["PAPERCLIP_", "npm_", "NPM_"] as const;
const VOLATILE_ENV_KEY_EXACT = new Set(["PWD", "OLDPWD", "SHLVL", "_", "TERM_SESSION_ID"]);

function firstNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function normalizeEnv(input: unknown): Record<string, string> {
  const envInput = typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envInput)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

function sortModels(models: AdapterModel[]): AdapterModel[] {
  return [...models].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }));
}

export function parseKilocodeModelsOutput(output: string): AdapterModel[] {
  const parsed: AdapterModel[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("Available models")) continue;
    const token = line.replace(/^\*\s*/, "").split(/\s+/)[0]?.trim() ?? "";
    if (!token.includes("/")) continue;
    parsed.push({ id: token, label: token });
  }
  return sortModels(dedupeModels(parsed));
}

function isVolatileEnvKey(key: string): boolean {
  if (VOLATILE_ENV_KEY_EXACT.has(key)) return true;
  return VOLATILE_ENV_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function discoveryCacheKey(command: string, provider: string, cwd: string, env: Record<string, string>) {
  const envKey = Object.entries(env)
    .filter(([key]) => !isVolatileEnvKey(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${hashValue(value)}`)
    .join("\n");
  return `${command}\n${provider}\n${cwd}\n${envKey}`;
}

function pruneExpiredDiscoveryCache(now: number) {
  for (const [key, value] of discoveryCache.entries()) {
    if (value.expiresAt <= now) discoveryCache.delete(key);
  }
}

export async function discoverKilocodeModels(input: {
  command?: unknown;
  provider?: unknown;
  cwd?: unknown;
  env?: unknown;
} = {}): Promise<AdapterModel[]> {
  const command = asString(input.command, DEFAULT_KILOCODE_EXECUTABLE);
  const provider = asString(input.provider, "").trim();
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(ensurePathInEnv({ ...process.env, ...normalizeEnv(input.env) }));
  const args = ["models", ...(provider ? [provider] : [])];

  const result = await runChildProcess(
    `kilocode-models-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    command,
    args,
    {
      cwd,
      env,
      timeoutSec: 20,
      graceSec: 3,
      onLog: async () => {},
    },
  );

  if (result.timedOut) throw new Error("`kilo models` timed out.");
  if ((result.exitCode ?? 1) !== 0) {
    const detail = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout);
    throw new Error(detail ? `\`kilo models\` failed: ${detail}` : "`kilo models` failed.");
  }

  return parseKilocodeModelsOutput(result.stdout || result.stderr);
}

export async function discoverKilocodeModelsCached(input: {
  command?: unknown;
  provider?: unknown;
  cwd?: unknown;
  env?: unknown;
} = {}): Promise<AdapterModel[]> {
  const command = asString(input.command, DEFAULT_KILOCODE_EXECUTABLE);
  const provider = asString(input.provider, "").trim();
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(input.env);
  const key = discoveryCacheKey(command, provider, cwd, env);
  const now = Date.now();
  pruneExpiredDiscoveryCache(now);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.models;
  const models = await discoverKilocodeModels({ command, provider, cwd, env });
  discoveryCache.set(key, { expiresAt: now + MODELS_CACHE_TTL_MS, models });
  return models;
}

export async function listKilocodeModels(): Promise<AdapterModel[]> {
  try {
    return await discoverKilocodeModelsCached();
  } catch {
    return [];
  }
}

export function resetKilocodeModelsCacheForTests() {
  discoveryCache.clear();
}