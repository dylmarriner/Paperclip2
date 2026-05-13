import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "cwd",
        label: "Working directory",
        type: "text",
        hint: "Absolute fallback workspace directory. Paperclip runtime workspace overrides this when present.",
      },
      {
        key: "instructionsFilePath",
        label: "Instructions file path",
        type: "text",
        hint: "Optional absolute path to a markdown instructions file injected into the prompt.",
      },
      {
        key: "authToken",
        label: "Windsurf auth token",
        type: "text",
        hint: "Windsurf authentication token for Cascade agent access. Get from Windsurf editor: Ctrl+Shift+P > Provide auth token",
      },
      {
        key: "model",
        label: "Model",
        type: "select",
        options: [
          { value: "swe-1.6", label: "SWE-1.6" },
          { value: "swe-1.5", label: "SWE-1.5" },
          { value: "swe-1", label: "SWE-1" },
          { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
          { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
          { value: "gpt-4o", label: "GPT-4o" },
        ],
      },
      {
        key: "dockerImage",
        label: "Docker image",
        type: "text",
        default: "pfcoperez/windsurfinabox:latest",
      },
      {
        key: "promptTemplate",
        label: "Prompt template",
        type: "textarea",
      },
      {
        key: "maxTurnsPerRun",
        label: "Max turns per run",
        type: "number",
        hint: "Optional max turns hint for the Dockerized agent runtime.",
      },
      {
        key: "env",
        label: "Environment JSON",
        type: "textarea",
        hint: "Optional JSON object of environment variables passed to docker run.",
      },
      {
        key: "dockerVolumes",
        label: "Docker volumes JSON",
        type: "textarea",
        hint: "Optional JSON array of { source, target } mounts. The workspace mount is added automatically.",
      },
      {
        key: "dockerNetwork",
        label: "Docker network",
        type: "text",
      },
      {
        key: "dockerAutoRemove",
        label: "Auto remove container",
        type: "toggle",
        default: true,
      },
      {
        key: "timeoutSec",
        label: "Timeout seconds",
        type: "number",
        default: 300,
      },
      {
        key: "graceSec",
        label: "Grace seconds",
        type: "number",
        default: 10,
      },
    ],
  };
}