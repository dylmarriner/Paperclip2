# Kilo Code Local Adapter

Adapter type: `kilocode_local`

## Install

```bash
npm install -g @kilocode/cli
kilo --version
```

## Example config

```json
{
  "adapterType": "kilocode_local",
  "adapterConfig": {
    "executablePath": "kilo",
    "cwd": "/srv/work/my-repo",
    "provider": "kilocode",
    "model": "your-model-id",
    "organizationId": "org_xxx",
    "timeoutSec": 1800,
    "env": "{}",
    "extraArgs": "[]"
  }
}
```

## Security notes

- Runs `kilo run --auto`.
- Kilo's own permission config decides which operations are approved.
- Do not enable broad write/shell approval until the repo is disposable or backed up.
- Do not store credentials in source control.