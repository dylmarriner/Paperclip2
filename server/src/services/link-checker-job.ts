import type { Db } from "@paperclipai/db";
import { LinkCheckerService, withRetry } from "./link-checker.js";
import { logger } from "../middleware/logger.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LinkCheckerJobResult {
  redirectRulesChecked: number
  redirectRulesPassed: number
  redirectRulesFailed: number
  staticUrlsChecked: number
  staticUrlsPassed: number
  staticUrlsFailed: number
  errors: string[]
}

async function checkStaticUrls(checker: LinkCheckerService): Promise<{ checked: number; passed: number; failed: number; errors: string[] }> {
  const urlsToVerify = [
    { url: "https://paperclip.ai", expectedStatus: 200 },
  ];

  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of urlsToVerify) {
    try {
      const result = await withRetry(() => checker.verifyUrl(item.url, item.expectedStatus), {
        maxAttempts: 3,
        baseDelayMs: 1000,
      });
      if (result.success) {
        passed++;
      } else {
        failed++;
        errors.push(`${item.url}: ${result.error ?? "unknown error"}`);
        logger.error({ url: item.url, error: result.error, status: result.status }, "Broken link detected");
      }
    } catch (err) {
      failed++;
      errors.push(`${item.url}: ${err instanceof Error ? err.message : "Unknown error"}`);
      logger.error({ url: item.url, err }, "Broken link check failed");
    }
  }

  return { checked: urlsToVerify.length, passed, failed, errors };
}

/**
 * Executes site crawl and link integrity check.
 * Returns stats about what was checked and any errors encountered.
 */
export async function runLinkCheckerJob(db: Db): Promise<LinkCheckerJobResult> {
  logger.info("Starting link checker job");
  const checker = new LinkCheckerService(db);
  const errors: string[] = [];

  // Load redirect map (static file, legacy)
  const redirectMapPath = path.resolve(__dirname, "../redirect-map.json");
  let redirectMap: Array<{ oldUrl: string; newUrl: string; statusCode: number }> = [];
  try {
    const data = await fs.readFile(redirectMapPath, "utf-8");
    redirectMap = JSON.parse(data);
    if (redirectMap.length > 0) {
      logger.info({ count: redirectMap.length }, "Loaded redirect map");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load redirect map, skipping static redirect checks");
  }

  // Verify static redirects (if any)
  for (const item of redirectMap) {
    try {
      const result = await withRetry(() => checker.verifyUrl(item.oldUrl, item.statusCode, true, item.newUrl), {
        maxAttempts: 3,
        baseDelayMs: 1000,
      });
      if (!result.success) {
        errors.push(`${item.oldUrl} -> ${item.newUrl}: ${result.error ?? "unknown error"}`);
        logger.error({ url: item.oldUrl, error: result.error, status: result.status }, "Broken redirect detected");
      }
    } catch (err) {
      errors.push(`${item.oldUrl} -> ${item.newUrl}: ${err instanceof Error ? err.message : "Unknown error"}`);
      logger.error({ url: item.oldUrl, err }, "Redirect check failed");
    }
  }

  // Check all active redirect rules from the database
  const redirectResult = await checker.checkAllRedirectRules();
  if (redirectResult.failed > 0) {
    errors.push(`${redirectResult.failed} of ${redirectResult.checked} redirect rules failed`);
    for (const detail of redirectResult.details) {
      if (!detail.success) {
        errors.push(`  ${detail.sourceUrl} -> ${detail.targetUrl}: ${detail.error ?? "unknown"}`);
        logger.error(
          { sourceUrl: detail.sourceUrl, targetUrl: detail.targetUrl, error: detail.error },
          "Broken redirect rule",
        );
      }
    }
  }
  logger.info(
    { checked: redirectResult.checked, passed: redirectResult.passed, failed: redirectResult.failed },
    "Redirect rule check completed",
  );

  // Check static URLs with retry
  const staticResult = await checkStaticUrls(checker);
  errors.push(...staticResult.errors);

  const result: LinkCheckerJobResult = {
    redirectRulesChecked: redirectResult.checked,
    redirectRulesPassed: redirectResult.passed,
    redirectRulesFailed: redirectResult.failed,
    staticUrlsChecked: staticResult.checked,
    staticUrlsPassed: staticResult.passed,
    staticUrlsFailed: staticResult.failed,
    errors,
  };

  if (result.errors.length > 0) {
    logger.warn({ errorCount: result.errors.length, result }, "Link checker job completed with errors");
  } else {
    logger.info(result, "Link checker job completed successfully");
  }

  return result;
}
