import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import { adapterType } from "../index.js";
import { prepareKilocodeCommand } from "./cli.js";

export function redactEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = /(key|token|secret|password|passwd|authorization|cookie)/i.test(key) ? "***REDACTED***" : value;
  }
  return out;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  try {
    const prepared = await prepareKilocodeCommand(ctx);
    await ctx.onMeta?.({
      adapterType,
      command: prepared.executable,
      commandArgs: prepared.args.slice(0, -1).concat("<prompt>"),
      cwd: prepared.cwd,
      env: redactEnv(prepared.env),
      prompt: prepared.prompt,
    });

    const result = await runChildProcess(ctx.runId, prepared.executable, prepared.args, {
      cwd: prepared.cwd,
      env: prepared.env,
      timeoutSec: prepared.timeoutSec,
      graceSec: 5,
      onLog: ctx.onLog,
      onSpawn: ctx.onSpawn,
    });

    const failed = result.exitCode !== 0 || result.timedOut;
    return {
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      provider: "kilocode",
      billingType: "unknown",
      errorMessage: failed ? summarizeKilocodeFailure(result) : null,
      summary: result.stdout.trim() || result.stderr.trim() || null,
      resultJson: {
        stdout: result.stdout,
        stderr: result.stderr,
        pid: result.pid,
        startedAt: result.startedAt,
      },
    };
  } catch (error) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      provider: "kilocode",
      billingType: "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export function summarizeKilocodeFailure(result: { exitCode: number | null; timedOut: boolean; stderr: string; stdout: string }): string {
  if (result.timedOut || result.exitCode === 124) return "Kilo Code CLI timed out. Increase timeoutSec or reduce the task scope.";
  const excerpt = (result.stderr || result.stdout).trim().slice(-4000);
  return excerpt ? `Kilo Code CLI failed: ${excerpt}` : `Kilo Code CLI failed with exit code ${result.exitCode}.`;
}