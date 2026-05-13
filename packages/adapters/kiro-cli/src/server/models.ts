import { createHash } from "node:crypto";
import type { AdapterModel } from "@paperclipai/adapter-utils";
import { asString, ensurePathInEnv, runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_KIRO_EXECUTABLE } from "../index.js";

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

export function parseKiroModelsOutput(output: string): AdapterModel[] {
  const parsed = JSON.parse(output) as unknown;
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { models?: unknown }).models)) {
    return [];
  }
  const models: AdapterModel[] = [];
  for (const entry of (parsed as { models: unknown[] }).models) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.model_id === "string" ? record.model_id.trim() : "";
    if (!id) continue;
    const name = typeof record.model_name === "string" ? record.model_name.trim() : id;
    const description = typeof record.description === "string" ? record.description.trim() : "";
    const label = description ? `${name} — ${description}` : name;
    models.push({ id, label });
  }
  return sortModels(dedupeModels(models));
}

function isVolatileEnvKey(key: string): boolean {
  if (VOLATILE_ENV_KEY_EXACT.has(key)) return true;
  return VOLATILE_ENV_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function discoveryCacheKey(command: string, cwd: string, env: Record<string, string>) {
  const envKey = Object.entries(env)
    .filter(([key]) => !isVolatileEnvKey(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${hashValue(value)}`)
    .join("\n");
  return `${command}\n${cwd}\n${envKey}`;
}

function pruneExpiredDiscoveryCache(now: number) {
  for (const [key, value] of discoveryCache.entries()) {
    if (value.expiresAt <= now) discoveryCache.delete(key);
  }
}

export async function discoverKiroModels(input: {
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
} = {}): Promise<AdapterModel[]> {
  const command = asString(input.command, DEFAULT_KIRO_EXECUTABLE);
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(ensurePathInEnv({ ...process.env, ...normalizeEnv(input.env) }));
  const result = await runChildProcess(
    `kiro-models-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    command,
    ["chat", "--list-models", "--format", "json"],
    {
      cwd,
      env,
      timeoutSec: 20,
      graceSec: 3,
      onLog: async () => {},
    },
  );

  if (result.timedOut) throw new Error("`kiro-cli chat --list-models` timed out.");
  if ((result.exitCode ?? 1) !== 0) {
    const detail = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout);
    throw new Error(detail ? `\`kiro-cli chat --list-models\` failed: ${detail}` : "`kiro-cli chat --list-models` failed.");
  }

  return parseKiroModelsOutput(result.stdout || result.stderr);
}

export async function discoverKiroModelsCached(input: {
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
} = {}): Promise<AdapterModel[]> {
  const command = asString(input.command, DEFAULT_KIRO_EXECUTABLE);
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(input.env);
  const key = discoveryCacheKey(command, cwd, env);
  const now = Date.now();
  pruneExpiredDiscoveryCache(now);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.models;
  const models = await discoverKiroModels({ command, cwd, env });
  discoveryCache.set(key, { expiresAt: now + MODELS_CACHE_TTL_MS, models });
  return models;
}

export async function listKiroModels(): Promise<AdapterModel[]> {
  try {
    return await discoverKiroModelsCached();
  } catch {
    return [];
  }
}

export function resetKiroModelsCacheForTests() {
  discoveryCache.clear();
}