# Kiro CLI Adapter

Adapter type: `kiro_cli`

## Install

```bash
kiro-cli --version
```

## ACP-first config

```json
{
  "adapterType": "kiro_cli",
  "adapterConfig": {
    "executablePath": "kiro-cli",
    "integrationMode": "auto",
    "cwd": "/srv/work/my-repo",
    "agent": "my-agent",
    "timeoutSec": 1800,
    "allowCommandFallback": true,
    "approvalMode": "read_only",
    "env": "{}"
  }
}
```

## Command fallback config

```json
{
  "adapterType": "kiro_cli",
  "adapterConfig": {
    "integrationMode": "command",
    "approvalMode": "configured",
    "trustTools": "read,grep,write",
    "env": "{\"KIRO_API_KEY\":\"secret-binding-or-runtime-value\"}"
  }
}
```

## Troubleshooting

- `kiro-cli not found`: set `executablePath` to the absolute binary path.
- ACP startup fails: set `integrationMode=command` temporarily, then inspect stderr.
- Headless auth fails: ensure `KIRO_API_KEY` is available through secret binding or runtime configuration.
- Tool calls rejected: use specific `trustTools` categories rather than `trust_all` unless the workspace is disposable.