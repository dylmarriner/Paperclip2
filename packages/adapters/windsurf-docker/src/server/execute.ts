import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asBoolean,
  asNumber,
  asString,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  parseObject,
  renderTemplate,
} from "@paperclipai/adapter-utils/server-utils";

export interface ExecuteOptions {
  cwd?: string;
  instructionsFilePath?: string;
  model?: string;
  dockerImage?: string;
  promptTemplate?: string;
  maxTurnsPerRun?: number;
  env?: Record<string, string>;
  authToken?: string;
  dockerVolumes?: Array<{ source: string; target: string }>;
  dockerNetwork?: string;
  dockerAutoRemove?: boolean;
  timeoutSec?: number;
  graceSec?: number;
  workspaceStrategy?: {
    type: "git_worktree";
    baseRef?: string;
    branchTemplate?: string;
    worktreeParentDir?: string;
  };
  workspaceRuntime?: Record<string, unknown>;
}

export interface ExecuteResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number | null;
  containerId?: string;
}

export async function runWindsurfDocker(
  prompt: string,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const {
    cwd = process.cwd(),
    instructionsFilePath,
    model,
    dockerImage = "pfcoperez/windsurfinabox:latest",
    dockerVolumes = [],
    dockerNetwork,
    dockerAutoRemove = true,
    timeoutSec = 300,
    graceSec = 10,
    env = {},
    authToken,
  } = options;

  // Prepare Docker volume mounts
  const volumes = [
    ...dockerVolumes,
    { source: cwd, target: "/workspace" },
  ];

  // Build volume arguments
  const volumeArgs = volumes.flatMap((v) => [
    "-v",
    `${v.source}:${v.target}`,
  ]);

  // Build environment variable arguments
  const envArgs = Object.entries(env).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`,
  ]);

  // Add auth token as environment variable if provided
  if (authToken) {
    envArgs.push("-e", `WINDSURF_TOKEN=${authToken}`);
  }

  // Build Docker command
  const dockerArgs = [
    "run",
    ...(dockerAutoRemove ? ["--rm"] : []),
    ...volumeArgs,
    ...envArgs,
    ...(dockerNetwork ? ["--network", dockerNetwork] : []),
    dockerImage,
  ];

  // Prepare the prompt
  let fullPrompt = prompt;
  if (instructionsFilePath) {
    try {
      const instructions = await fs.readFile(instructionsFilePath, "utf-8");
      fullPrompt = `${instructions}\n\n---\n\n${prompt}`;
    } catch (error) {
      console.error(`Failed to read instructions file: ${instructionsFilePath}`, error);
    }
  }

  return new Promise((resolve) => {
    let output = "";
    let errorOutput = "";
    let containerId: string | undefined;

    const child = spawn("docker", dockerArgs, {
      cwd,
      env: { ...process.env, ...env },
    });

    // Write prompt to stdin
    child.stdin?.write(fullPrompt);
    child.stdin?.end();

    child.stdout?.on("data", (data) => {
      output += data.toString();
    });

    child.stderr?.on("data", (data) => {
      const text = data.toString();
      errorOutput += text;
      
      // Try to extract container ID from Docker output
      const match = text.match(/([a-f0-9]{12})/);
      if (match && !containerId) {
        containerId = match[1];
      }
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve({
          success: false,
          output,
          error: `Timeout after ${timeoutSec}s`,
          exitCode: null,
          containerId,
        });
      }, graceSec * 1000);
    }, timeoutSec * 1000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        success: code === 0,
        output,
        error: errorOutput || undefined,
        exitCode: code,
        containerId,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        output,
        error: err.message,
        exitCode: null,
        containerId,
      });
    });
  });
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  try {
    const config = parseObject(ctx.config);
    const workspace = parseObject(ctx.context.paperclipWorkspace);
    const cwd = asString(workspace.cwd, "").trim() || asString(config.cwd, process.cwd()).trim() || process.cwd();
    const promptTemplate = asString(config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE);
    const prompt = renderTemplate(promptTemplate, {
      agent: ctx.agent,
      runtime: ctx.runtime,
      context: ctx.context,
      runId: ctx.runId,
    });

    const result = await runWindsurfDocker(prompt, {
      cwd,
      instructionsFilePath: asString(config.instructionsFilePath, "") || undefined,
      model: asString(config.model, "") || undefined,
      dockerImage: asString(config.dockerImage, "") || undefined,
      maxTurnsPerRun: asNumber(config.maxTurnsPerRun, 0) || undefined,
      authToken: asString(config.authToken, "") || undefined,
      env: (() => {
        const envConfig = parseObject(config.env);
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(envConfig)) {
          if (typeof value === "string") env[key] = value;
        }
        return env;
      })(),
      dockerVolumes: Array.isArray(config.dockerVolumes)
        ? (config.dockerVolumes as Array<{ source: string; target: string }>)
        : undefined,
      dockerNetwork: asString(config.dockerNetwork, "") || undefined,
      dockerAutoRemove: asBoolean(config.dockerAutoRemove, true),
      timeoutSec: Math.max(1, asNumber(config.timeoutSec, 300)),
      graceSec: Math.max(1, asNumber(config.graceSec, 10)),
    });

    return {
      exitCode: result.exitCode,
      signal: null,
      timedOut: result.exitCode === null && !result.success,
      provider: "windsurf",
      model: asString(config.model, "") || null,
      billingType: "unknown",
      errorMessage: result.success ? null : result.error ?? "Windsurf Docker execution failed.",
      summary: result.output.trim() || result.error || null,
      resultJson: {
        output: result.output,
        error: result.error ?? null,
        containerId: result.containerId ?? null,
      },
      sessionParams: result.containerId ? { containerId: result.containerId, cwd } : null,
      sessionDisplayId: result.containerId ?? null,
      sessionId: result.containerId ?? null,
    };
  } catch (error) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      provider: "windsurf",
      billingType: "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
