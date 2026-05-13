export const type = "kiro_cli";
export const adapterType = type;
export const label = "Kiro CLI";

export const DEFAULT_KIRO_EXECUTABLE = "kiro-cli";
export const DEFAULT_KIRO_TIMEOUT_SEC = 1800;

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# kiro_cli agent configuration

Adapter: kiro_cli

Use when:
- You want Paperclip to run Kiro CLI locally as the agent runtime
- You prefer ACP mode via \`kiro-cli acp\`
- You need command fallback through \`kiro-cli chat --no-interactive\`

Core fields:
- executablePath (string, optional): defaults to \`kiro-cli\`
- cwd (string, optional): fallback working directory for the Kiro process
- integrationMode (auto | acp | command): defaults to ACP first, command fallback
- agent (string, optional): optional ACP --agent value
- model (string, optional): optional ACP session/set_model value where supported
- sessionId (string, optional): load an existing ACP session instead of creating one
- approvalMode (read_only | configured | trust_all | none): command fallback trust flags
- trustTools (string, optional): comma-separated tools for configured command fallback
- requireMcpStartup (boolean, optional): prepends --require-mcp-startup in command mode
- allowCommandFallback (boolean, optional): whether auto mode may fall back after ACP failure
- extraArgs (JSON string[] or string[], optional): appended before the prompt in command mode
- env (object or JSON object string, optional): explicit environment variables

Security notes:
- ACP mode is preferred.
- Command fallback uses read/grep trust by default.
- Do not hardcode KIRO_API_KEY or credentials in repo files.
`;