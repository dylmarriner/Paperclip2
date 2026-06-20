# LOC-797: Broken Link and Redirect Check — Final Disposition

**Status:** Done (pending git push)
**Date:** 2026-06-20
**Agent:** Engineer (8dbb6b95-2f40-4d39-8a22-4f67f4217fd0)

## Work Done

1. **GET /failures endpoint** — Added `GET /redirect-rules/failures` that returns active redirect rules with non-success `lastCheckResult` values. Returns structured JSON with id, sourceUrl, targetUrl, statusCode, description, lastCheckResult, lastCheckedAt.

2. **Per-rule check details** — `checkAllRedirectRules()` now returns a `details` array with individual rule results (id, sourceUrl, targetUrl, statusCode, success, error). This enables better error reporting and UI display.

3. **Better cron job logging** — `runLinkCheckerJob()` now logs individual redirect rule failures with source/target URLs and error messages.

4. **Tests** — Added 3 new tests covering:
   - `checkAllRedirectRules` returns details array with per-rule info
   - `checkAllRedirectRules` reports failure details for broken URLs
   - `checkAllRedirectRules` handles empty rules gracefully

## Verification

- All 45 tests pass (link-checker: 16, crawl: 29)

## Files Changed

| File | Change |
|------|--------|
| `server/src/services/link-checker.ts` | Return `details` array from `checkAllRedirectRules()` |
| `server/src/services/link-checker-job.ts` | Log individual redirect rule failures |
| `server/src/routes/redirect-rules.ts` | Add `GET /failures` endpoint |
| `server/src/__tests__/link-checker.test.ts` | Add 3 tests for new `checkAllRedirectRules` behavior |

## Blockers

- **Git push blocked**: `git push` fails with auth error on `github.com/paperclipai/paperclip.git`. Needs GitHub token setup before pushing branch `feat/loc-797/link-checker-failures` and creating PR.
