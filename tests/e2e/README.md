# E2E Test Framework

## Overview

End-to-end browser tests using Playwright. Tests boot a throwaway Paperclip
instance in `local_trusted` mode and execute critical user flows through the
browser UI and API.

## Quick Start

```bash
# Install Playwright browsers (one-time)
npx playwright install --with-deps chromium

# Build the project
pnpm build

# Run E2E tests (skips LLM-dependent assertions)
pnpm test:e2e

# Run with LLM assertions (requires ANTHROPIC_API_KEY)
PAPERCLIP_E2E_SKIP_LLM=false pnpm test:e2e

# Run with headed browser (debug)
pnpm test:e2e:headed
```

## Test Suites

| Config | Specs | Mode | Port | CI Job |
|--------|-------|------|------|--------|
| `playwright.config.ts` | onboarding, signoff-policy, planning-mode | local_trusted | 3199 | PR `e2e` |
| `playwright-multiuser.config.ts` | multi-user | local_trusted | 3104 | manual |
| `playwright-multiuser-authenticated.config.ts` | multi-user-authenticated | authenticated | 3105 | manual |

### Main Suite (7 tests)

Boots a dedicated throwaway instance via `pnpm paperclipai onboard --yes --run`.

- **Onboarding** (1 test): Full wizard flow — company creation, agent setup,
  task creation, issue page verification. API assertions verify data integrity.
- **Signoff Policy** (5 tests): Full signoff lifecycle — happy path
  (executor→reviewer→approver→done), changes requested bounce-back, comment
  validation, access control (non-participant rejection), review-only policy.
- **Planning Mode Visual** (1 test): Planning mode UI verification with
  screenshots at desktop and mobile viewports.

### Multi-User Suite (18 tests)

Requires a pre-running server on port 3104. Not automatically booted.

- Member management API (list, update role, suspend)
- Human invite creation and acceptance (API)
- Agent invite creation and join requests
- Role-based access control (viewer read-only)
- Last-owner protection
- Company Settings UI (member list, role editing, invite creation)
- Invite landing page UI

### Multi-User Authenticated Suite (1 test)

Requires a pre-running server in `authenticated` mode on port 3105.
Uses a bootstrap invite script to seed the owner account.

- Full authenticated flow: signup, bootstrap invite acceptance, company
  creation, invite creation, invitee signup/join, viewer role restriction.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PAPERCLIP_E2E_SKIP_LLM` | `true` | Skip LLM-dependent assertions |
| `PAPERCLIP_E2E_PORT` | `3199` | Server port for main suite |
| `PAPERCLIP_E2E_BASE_URL` | varies | Override base URL for multi-user suites |
| `PAPERCLIP_E2E_DATA_DIR` | `PAPERCLIP_HOME` | Data directory for auth bootstrap |
| `PAPERCLIP_E2E_CONFIG_PATH` | `.paperclip/config.json` | Config path for auth bootstrap |

### Release Smoke Test

| Variable | Default | Purpose |
|----------|---------|---------|
| `PAPERCLIP_RELEASE_SMOKE_BASE_URL` | `http://127.0.0.1:3232` | URL of the running release smoke instance |
| `PAPERCLIP_RELEASE_SMOKE_EMAIL` / `SMOKE_ADMIN_EMAIL` | `smoke-admin@paperclip.local` | Admin email for sign-in |
| `PAPERCLIP_RELEASE_SMOKE_PASSWORD` / `SMOKE_ADMIN_PASSWORD` | `paperclip-smoke-password` | Admin password for sign-in |

## CI Integration

### PR Workflow (`.github/workflows/pr.yml`)

- Runs `pnpm test:e2e` (main suite only, skip LLM) after build
- Installs Playwright with Chromium deps
- Generates a temporary `config.json` for `local_trusted` mode
- Uploads Playwright report + test results on failure
- Timeout: 30 minutes

### Standalone E2E Workflow (`.github/workflows/e2e.yml`)

- `workflow_dispatch` only
- Configurable LLM skip
- Builds, runs full suite, uploads artifacts
- Timeout: 30 minutes
- Notifies on failure

## Test Architecture

### Bootstrap

The main suite uses Playwright's `webServer` directive:

```ts
webServer: {
  command: `pnpm paperclipai onboard --yes --run`,
  url: `${BASE_URL}/api/health`,
  reuseExistingServer: false,
  timeout: 120_000,
  env: {
    PORT: String(PORT),
    PAPERCLIP_HOME,  // temp directory
    PAPERCLIP_DEPLOYMENT_MODE: "local_trusted",
  },
}
```

Each test run gets a fresh temp directory and throwaway instance. No state
leaks between runs.

### Agent Auth

Tests authenticate as agents via API keys created through the board
(local_trusted auto-auth). Heartbeat run IDs are used for authorization:

```ts
const runId = await invokeHeartbeat(board, agentId);
const res = await agent.request.patch(url, {
  headers: { "X-Paperclip-Run-Id": runId },
  data: { ... },
});
```

## Adding Tests

1. Create `*.spec.ts` in `tests/e2e/`
2. Import from `@playwright/test`
3. If the test needs API-only auth, use the signoff-policy pattern
4. Use unique, timestamped company names to avoid collisions
5. Set `SKIP_LLM` support for LLM-dependent assertions
6. Clean up created resources in `afterAll` (best-effort)

## Coverage Gaps

- **Issue CRUD**: No dedicated test for creating/editing/deleting issues outside
  the onboarding flow
- **Agent heartbeat lifecycle**: No test for agent scheduling or wake
- **Dashboard**: No test for dashboard rendering or agent activity view
- **Search**: No E2E search test
- **Messaging/chat**: No E2E test for chat interactions
- **UI component unit tests**: Zero tests in `ui/src/`
- **Visual regression**: Screenshots are taken but not compared against baselines
