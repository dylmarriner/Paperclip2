import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { asBoolean, asString } from "@paperclipai/adapter-utils/server-utils";
import { adapterType } from "../index.js";
import { runKiroAcp } from "./acp.js";
import { runKiroCommandFallback } from "./command.js";
import { prepareKiroExecution, redactEnv } from "./shared.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  try {
    const prepared = await prepareKiroExecution(ctx);

    if (prepared.mode === "acp" || prepared.mode === "auto") {
      try {
        await ctx.onMeta?.({ adapterType, command: prepared.executable, commandArgs: ["acp"], cwd: prepared.cwd, prompt: prepared.prompt, env: redactEnv(prepared.env) });
        const result = await runKiroAcp({
          executable: prepared.executable,
          cwd: prepared.cwd,
          env: prepared.env,
          agent: asString(prepared.config.agent, "").trim() || undefined,
          model: asString(prepared.config.model, "").trim() || undefined,
          sessionId: asString(prepared.config.sessionId, "").trim() || undefined,
          prompt: prepared.prompt,
          timeoutSec: prepared.timeoutSec,
          onLog: ctx.onLog,
        });
        const failed = result.exitCode !== 0 || result.timedOut;
        return {
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          provider: "kiro",
          billingType: "unknown",
          sessionId: result.sessionId,
          sessionParams: result.sessionId ? { sessionId: result.sessionId } : null,
          sessionDisplayId: result.sessionId,
          summary: result.text.trim() || null,
          errorMessage: failed ? "Kiro ACP run failed or timed out." : null,
          resultJson: { mode: "acp", text: result.text, sessionId: result.sessionId },
        };
      } catch (error) {
        if (prepared.mode === "acp" || !asBoolean(prepared.config.allowCommandFallback, true)) throw error;
        await ctx.onLog("stderr", `Kiro ACP failed, falling back to command mode: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }

    return await runKiroCommandFallback(ctx, prepared);
  } catch (error) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      provider: "kiro",
      billingType: "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}