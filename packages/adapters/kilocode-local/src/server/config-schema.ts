import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";
import { DEFAULT_KILOCODE_EXECUTABLE, DEFAULT_KILOCODE_TIMEOUT_SEC } from "../index.js";

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "executablePath",
        label: "Kilo executable",
        type: "text",
        default: DEFAULT_KILOCODE_EXECUTABLE,
        hint: "Absolute path or command name. Falls back to kilo.",
      },
      {
        key: "cwd",
        label: "Working directory",
        type: "text",
        hint: "Absolute fallback workspace directory. Paperclip runtime workspace overrides this when present.",
      },
      {
        key: "agentMode",
        label: "Kilo agent mode",
        type: "text",
        hint: "Optional mode/profile identifier for env/extra-arg based Kilo configurations.",
      },
      {
        key: "provider",
        label: "Provider override",
        type: "text",
        hint: "Optional KILO_PROVIDER env override.",
      },
      {
        key: "model",
        label: "Model override",
        type: "text",
        hint: "Optional model env override. For provider=kilocode, KILOCODE_MODEL is used; otherwise KILO_MODEL is used.",
      },
      {
        key: "organizationId",
        label: "Kilo organization ID",
        type: "text",
        hint: "Optional KILO_ORG_ID for non-interactive runs.",
      },
      {
        key: "timeoutSec",
        label: "Timeout seconds",
        type: "number",
        default: DEFAULT_KILOCODE_TIMEOUT_SEC,
      },
      {
        key: "extraArgs",
        label: "Extra CLI args JSON",
        type: "textarea",
        hint: "Optional JSON string array appended before the prompt. Do not include shell syntax.",
      },
      {
        key: "env",
        label: "Environment JSON",
        type: "textarea",
        hint: "Optional JSON object. Only explicit values here plus a tiny safe base env are passed to Kilo.",
      },
      {
        key: "promptTemplate",
        label: "Prompt template",
        type: "textarea",
      },
    ],
  };
}