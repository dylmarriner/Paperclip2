export const type = "windsurf_docker";
export const label = "Windsurf (Docker)";

export const models = [
  { id: "swe-1.6", label: "SWE-1.6" },
  { id: "swe-1.5", label: "SWE-1.5" },
  { id: "swe-1", label: "SWE-1" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
  { id: "gpt-4o", label: "GPT-4o" },
];

export const agentConfigurationDoc = `# windsurf_docker agent configuration

Adapter: windsurf_docker

This adapter runs Windsurf's Cascade agent in a Docker container for headless operation.

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file injected at runtime
- model (string, optional): Windsurf Cascade model id
- dockerImage (string, optional): Docker image to use (default: pfcoperez/windsurfinabox:latest)
- promptTemplate (string, optional): run prompt template
- maxTurnsPerRun (number, optional): max turns for one run
- env (object, optional): KEY=VALUE environment variables for the Docker container
- workspaceStrategy (object, optional): execution workspace strategy; currently supports { type: "git_worktree", baseRef?, branchTemplate?, worktreeParentDir? }
- workspaceRuntime (object, optional): reserved for workspace runtime metadata; workspace runtime services are manually controlled from the workspace UI and are not auto-started by heartbeats

Docker-specific fields:
- dockerVolumes (object[], optional): Docker volume mounts in format { source: string, target: string }
- dockerNetwork (string, optional): Docker network to connect the container to
- dockerAutoRemove (boolean, optional): automatically remove container after execution (default: true)

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- This adapter requires Docker to be installed and running on the host system
- The default Docker image (pfcoperez/windsurfinabox) provides a headless Windsurf Cascade environment
- Workspace directories are mounted into the Docker container as volumes
- When Paperclip realizes a workspace/runtime for a run, it injects PAPERCLIP_WORKSPACE_* and PAPERCLIP_RUNTIME_* env vars for agent-side tooling
- Skills are discovered from .windsurf/skills directories in the workspace
`;
