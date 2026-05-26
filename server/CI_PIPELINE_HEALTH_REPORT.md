# CI Pipeline Health Report

**Date:** 2026-05-26
**Status:** GOOD — 6 workflows operational. 1 new blocker found, 3 prior issues fixed.

## Pipeline Overview

| Workflow | Trigger | Health | Notes |
|----------|---------|--------|-------|
| `pr.yml` | PR → master | ✓ GOOD | 6 parallel job families, 20m timeouts |
| `e2e.yml` | workflow_dispatch | ⚠ NEEDS SECRET | Requires `ANTHROPIC_API_KEY` secret |
| `release.yml` | push master + dispatch | ✓ GOOD | 30m per job, multi-step verify+publish |
| `release-smoke.yml` | dispatch + call | ✓ GOOD | Manual / workflow_call smoke testing |
| `refresh-lockfile.yml` | push master + schedule | ✓ GOOD | Cron + push-triggered lockfile refresh |
| `docker.yml` | push master + tags | ⚠ BLOCKER FOUND | Multi-arch build missing QEMU setup |

## Issues Found & Fixed (Previous Beat)

### 1. Node.js version drift (HIGH) — FIXED
- **Found:** `e2e.yml` and `refresh-lockfile.yml` pinned node-version `20` while `pr.yml` and `release.yml` used `24`.
- **Fix:** Bumped both to `24` — consistent across all workflows.

### 2. pnpm version unpinned (LOW) — FIXED
- **Found:** `e2e.yml` specified `version: 9` (flexible major) instead of a concrete minor.
- **Fix:** Pinned to `9.15.4` — matching `pr.yml` and `release.yml`.

### 3. Missing CI status badge (LOW) — FIXED
- **Found:** README had no CI badge.
- **Fix:** Added `[CI]` badge tracking the `pr.yml` workflow on master.

## Issues Found (This Beat)

### 4. Multi-arch Docker build missing QEMU setup (MEDIUM) — NEW
- **Found:** `docker.yml` builds for `linux/amd64,linux/arm64` (line 50) but lacks `docker/setup-qemu-action@v3` before `docker/setup-buildx-action@v3`.
- **Risk:** GitHub-hosted runners do not preinstall QEMU. Without explicit QEMU setup, the arm64 build target will fail with `exec format error` or similar cross-architecture errors.
- **Fix:** Add `docker/setup-qemu-action@v3` step before `docker/setup-buildx-action@v3` in `docker.yml`.

### 5. e2e.yml depends on ANTHROPIC_API_KEY secret (LOW) — NEW
- **Found:** Standalone `e2e.yml` passes `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}` (line 17).
- **Risk:** Workflow fails for users/forks without this secret configured. The PR pipeline's e2e job handles this correctly by using `PAPERCLIP_E2E_SKIP_LLM: "true"`.
- **Fix:** Add a conditional or fallback — skip LLM-dependent assertions when the secret is absent, matching the PR pipeline pattern.

## Remaining Recommendations (Deferred)

- Add `.node-version` file at repo root to align local dev with CI Node 24.
- Consider adding a `lint` or `format-check` job to the PR pipeline.
- Add workflow failure notifications (e.g. Discord webhook on `pr.yml` failure).
