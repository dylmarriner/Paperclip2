import { Db } from "@paperclipai/db";
import { LinkCheckerService } from "./link-checker.js";
import { logger } from "../middleware/logger.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Executes site crawl and link integrity check.
 */
export async function runLinkCheckerJob(db: Db) {
  logger.info("Starting link checker job");
  const checker = new LinkCheckerService(db);
  
  // Load redirect map
  const redirectMapPath = path.resolve(__dirname, "../redirect-map.json");
  let redirectMap: Array<{ oldUrl: string; newUrl: string; statusCode: number }> = [];
  try {
    const data = await fs.readFile(redirectMapPath, "utf-8");
    redirectMap = JSON.parse(data);
  } catch (err) {
    logger.warn({ err }, "Failed to load redirect map, skipping redirect checks");
  }

  // Verify redirects
  for (const item of redirectMap) {
    const result = await checker.verifyUrl(item.oldUrl, item.statusCode, true, item.newUrl);
    if (!result.success) {
      logger.error({ url: item.oldUrl, error: result.error, status: result.status }, "Broken redirect detected");
    }
  }

  // Example: Add other URLs to check here
  const urlsToVerify = [
    { url: "https://paperclip.ai", expectedStatus: 200 },
  ];

  for (const item of urlsToVerify) {
    const result = await checker.verifyUrl(item.url, item.expectedStatus);
    if (!result.success) {
      logger.error({ url: item.url, error: result.error, status: result.status }, "Broken link detected");
    }
  }
  logger.info("Link checker job completed");
}
