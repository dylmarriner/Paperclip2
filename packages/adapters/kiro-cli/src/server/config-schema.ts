import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";
import { DEFAULT_KIRO_EXECUTABLE, DEFAULT_KIRO_TIMEOUT_SEC } from "../index.js";

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      { key: "executablePath", label: "Kiro executable", type: "text", default: DEFAULT_KIRO_EXECUTABLE, hint: "Absolute path or command name. Prefer kiro-cli." },
      { key: "cwd", label: "Working directory", type: "text", hint: "Absolute fallback workspace directory. Paperclip runtime workspace overrides this when present." },
      { key: "integrationMode", label: "Integration mode", type: "select", default: "auto", options: [
        { value: "auto", label: "Auto: ACP first, command fallback" },
        { value: "acp", label: "ACP only" },
        { value: "command", label: "Command mode only" },
      ] },
      { key: "agent", label: "Kiro agent", type: "text", hint: "Optional --agent value for ACP mode." },
      { key: "model", label: "Model", type: "text", hint: "Optional session/set_model value for ACP mode where supported." },
      { key: "sessionId", label: "Session ID", type: "text", hint: "Optional ACP session id to load instead of creating a new session." },
      { key: "approvalMode", label: "Approval mode", type: "select", default: "read_only", options: [
        { value: "read_only", label: "Trust read/grep only" },
        { value: "configured", label: "Use trustTools" },
        { value: "trust_all", label: "Trust all tools" },
        { value: "none", label: "No trust flags" },
      ] },
      { key: "trustTools", label: "Trusted tool categories", type: "text", default: "read,grep", hint: "Comma-separated categories for --trust-tools in command fallback." },
      { key: "requireMcpStartup", label: "Require MCP startup", type: "toggle", default: false },
      { key: "allowCommandFallback", label: "Allow command fallback", type: "toggle", default: true },
      { key: "timeoutSec", label: "Timeout seconds", type: "number", default: DEFAULT_KIRO_TIMEOUT_SEC },
      { key: "extraArgs", label: "Extra CLI args JSON", type: "textarea", hint: "Optional JSON string array appended before the prompt in command mode." },
      { key: "env", label: "Environment JSON", type: "textarea", hint: "Optional JSON object. KIRO_API_KEY may be supplied through secret binding, not source code." },
      { key: "promptTemplate", label: "Prompt template", type: "textarea" },
    ],
  };
}