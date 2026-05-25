# CI Pipeline Health Report

**Date:** 2026-05-25
**Status:** GOOD — All 6 workflows operational, 3 issues found and fixed.

## Pipeline Overview

| Workflow | Trigger | Health | Notes |
|----------|---------|--------|-------|
| `pr.yml` | PR → master | ✓ GOOD | 6 parallel job families, 20m timeouts |
| `e2e.yml` | workflow_dispatch | ✓ GOOD | 30m timeout, Playwright + LLM skip option |
| `release.yml` | push master + dispatch | ✓ GOOD | 30m per job, multi-arch Docker |
| `release-smoke.yml` | dispatch + call | ✓ GOOD | Manual / workflow_call smoke testing |
| `refresh-lockfile.yml` | push master + schedule | ✓ GOOD | Cron + push-triggered lockfile refresh |
| `docker.yml` | push master + tags | ✓ GOOD | 60m, multi-arch (amd64+arm64) |

## Issues Found & Fixed

### 1. Node.js version drift (HIGH)
- **Found:** `e2e.yml` and `refresh-lockfile.yml` pinned node-version `20` while `pr.yml` and `release.yml` used `24`.
- **Fix:** Bumped both to `24` — consistent across all workflows.

### 2. pnpm version unpinned (LOW)
- **Found:** `e2e.yml` specified `version: 9` (flexible major) instead of a concrete minor.
- **Fix:** Pinned to `9.15.4` — matching `pr.yml` and `release.yml`.

### 3. Missing CI status badge (LOW)
- **Found:** README had no CI badge.
- **Fix:** Added `[CI]` badge tracking the `pr.yml` workflow on master.

## Dependencies & Action Versions (All Workflows)

All 6 workflows consistently use:
- `actions/checkout@v4`
- `pnpm/action-setup@v4` with `version: 9.15.4`
- `actions/setup-node@v4` with `node-version: 24`, `cache: pnpm`
- `actions/upload-artifact@v4` (smoke, e2e)
- `docker/login-action@v3`, `docker/setup-buildx-action@v3`, `docker/metadata-action@v5`, `docker/build-push-action@v6`
- `docker://node:24-alpine` (release job)
- `dawidd6/action-download-artifact@v9` (release smoke)

## Test Suite Structure

PR pipeline runs tests in 2 parallel tracks:
- **General tests:** 3 groups (server, workspaces-a, workspaces-b) — 20m timeout each
- **Serialized server tests:** 4 shards — 20m timeout each

Plus separate typecheck, build, canary dry-run, and E2E jobs.

## Recommendations

- Add `.node-version` file at repo root to align local dev with CI Node 24.
- Consider adding a `lint` or `format-check` job to the PR pipeline.
- Add workflow failure notifications (e.g. Discord webhook on `pr.yml` failure).
