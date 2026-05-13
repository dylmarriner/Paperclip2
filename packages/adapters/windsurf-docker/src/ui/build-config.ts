export interface WindsurfDockerConfig {
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

export function buildWindsurfDockerConfig(
  config: Record<string, unknown>,
): WindsurfDockerConfig {
  return {
    cwd: typeof config.cwd === "string" ? config.cwd : undefined,
    instructionsFilePath: typeof config.instructionsFilePath === "string" ? config.instructionsFilePath : undefined,
    model: typeof config.model === "string" ? config.model : undefined,
    dockerImage: typeof config.dockerImage === "string" ? config.dockerImage : undefined,
    promptTemplate: typeof config.promptTemplate === "string" ? config.promptTemplate : undefined,
    maxTurnsPerRun: typeof config.maxTurnsPerRun === "number" ? config.maxTurnsPerRun : undefined,
    env: typeof config.env === "object" && config.env !== null ? config.env as Record<string, string> : undefined,
    authToken: typeof config.authToken === "string" ? config.authToken : undefined,
    dockerVolumes: Array.isArray(config.dockerVolumes) ? config.dockerVolumes as Array<{ source: string; target: string }> : undefined,
    dockerNetwork: typeof config.dockerNetwork === "string" ? config.dockerNetwork : undefined,
    dockerAutoRemove: typeof config.dockerAutoRemove === "boolean" ? config.dockerAutoRemove : undefined,
    timeoutSec: typeof config.timeoutSec === "number" ? config.timeoutSec : undefined,
    graceSec: typeof config.graceSec === "number" ? config.graceSec : undefined,
    workspaceStrategy: typeof config.workspaceStrategy === "object" && config.workspaceStrategy !== null 
      ? config.workspaceStrategy as WindsurfDockerConfig["workspaceStrategy"]
      : undefined,
    workspaceRuntime: typeof config.workspaceRuntime === "object" && config.workspaceRuntime !== null
      ? config.workspaceRuntime as Record<string, unknown>
      : undefined,
  };
}
