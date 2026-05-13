export const type = "kilocode_local";
export const adapterType = type;
export const label = "Kilo Code (local)";

export const DEFAULT_KILOCODE_TIMEOUT_SEC = 1800;
export const DEFAULT_KILOCODE_EXECUTABLE = "kilo";

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# kilocode_local agent configuration

Adapter: kilocode_local

Use when:
- You want Paperclip to run Kilo Code CLI locally as the agent runtime
- You want non-interactive Kilo automation through \`kilo run --auto\`
- You have already configured Kilo provider/auth settings for the OS user running Paperclip

Don't use when:
- You need webhook-style external invocation (use openclaw_gateway or http)
- Kilo CLI is not installed on the machine

Core fields:
- executablePath (string, optional): defaults to \`kilo\`
- cwd (string, optional): fallback working directory for the Kilo process
- promptTemplate (string, optional): user prompt template passed as the run prompt
- provider (string, optional): sets KILO_PROVIDER
- model (string, optional): sets KILOCODE_MODEL when provider is \`kilocode\`, otherwise KILO_MODEL
- organizationId (string, optional): sets KILO_ORG_ID
- extraArgs (JSON string[] or string[], optional): appended before the prompt
- env (object or JSON object string, optional): explicit environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds

Security notes:
- Paperclip passes only a small safe base environment plus configured env values.
- Kilo's own auto-approval and permission configuration controls what the CLI may do.
- Do not store credentials in source control.
`;