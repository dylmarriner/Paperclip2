import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { asBoolean, asString, runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import { adapterType } from "../index.js";
import { parseStringArrayJson, redactEnv } from "./shared.js";

export function trustArgs(config: Record<string, unknown>): string[] {
  const approvalMode = asString(config.approvalMode, "read_only");
  const args: string[] = [];
  if (asBoolean(config.requireMcpStartup, false)) args.push("--require-mcp-startup");
  if (approvalMode === "none") return args;
  if (approvalMode === "trust_all") return [...args, "--trust-all-tools"];
  const tools = approvalMode === "configured" ? asString(config.trustTools, "read,grep").trim() : "read,grep";
  return tools ? [...args, `--trust-tools=${tools}`] : args;
}

export function buildKiroCommandArgs(config: Record<string, unknown>, prompt: string): string[] {
  return ["chat", "--no-interactive", ...trustArgs(config), ...parseStringArrayJson(config.extraArgs, "extraArgs"), prompt];
}

export async function runKiroCommandFallback(
  ctx: AdapterExecutionContext,
  input: { executable: string; cwd: string; env: Record<string, string>; prompt: string; timeoutSec: number; config: Record<string, unknown> },
): Promise<AdapterExecutionResult> {
  const args = buildKiroCommandArgs(input.config, input.prompt);
  await ctx.onMeta?.({ adapterType, command: input.executable, commandArgs: args.slice(0, -1).concat("<prompt>"), cwd: input.cwd, env: redactEnv(input.env), prompt: input.prompt });
  const result = await runChildProcess(ctx.runId, input.executable, args, {
    cwd: input.cwd,
    env: input.env,
    timeoutSec: input.timeoutSec,
    graceSec: 5,
    onLog: ctx.onLog,
    onSpawn: ctx.onSpawn,
  });
  const failed = result.exitCode !== 0 || result.timedOut;
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    provider: "kiro",
    billingType: "unknown",
    summary: result.stdout.trim() || result.stderr.trim() || null,
    errorMessage: failed ? summarizeCommandFailure(result) : null,
    resultJson: { mode: "command", stdout: result.stdout, stderr: result.stderr },
  };
}

export function summarizeCommandFailure(result: { exitCode: number | null; timedOut: boolean; stderr: string; stdout: string }): string {
  if (result.timedOut) return "Kiro CLI timed out. Increase timeoutSec or reduce the task scope.";
  const excerpt = (result.stderr || result.stdout).trim().slice(-4000);
  return excerpt ? `Kiro CLI failed: ${excerpt}` : `Kiro CLI failed with exit code ${result.exitCode}.`;
}