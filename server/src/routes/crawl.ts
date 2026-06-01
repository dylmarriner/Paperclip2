import type { Db } from "@paperclipai/db"
import { Router } from "express"
import { LinkCheckerService } from "../services/link-checker.js"

export function crawlRoutes(db: Db): Router {
  const router = Router()
  const checker = new LinkCheckerService(db)

  router.post("/start", async (req, res, next) => {
    try {
      const { url, maxDepth, maxPages, requestDelayMs, respectRobotsTxt, checkExternalLinks } = req.body
      if (!url) {
        res.status(400).json({ error: "url is required" })
        return
      }

      const results = await checker.crawlAndCheckLinks(url, maxDepth ?? 2, maxPages ?? 50, {
        requestDelayMs,
        respectRobotsTxt,
        checkExternalLinks,
      })

      res.json({
        pagesCrawled: results.length,
        totalLinks: results.reduce((s, r) => s + r.links.length, 0),
        brokenLinks: results.reduce((s, r) => s + r.links.filter((l) => l.isBroken).length, 0),
        results,
      })
    } catch (err) {
      next(err)
    }
  })

  router.post("/single", async (req, res, next) => {
    try {
      const { url } = req.body
      if (!url) {
        res.status(400).json({ error: "url is required" })
        return
      }

      const result = await checker.crawlSinglePage(url)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.get("/results", async (_req, res, next) => {
    try {
      const results = await checker.getCrawlResults()
      res.json(results)
    } catch (err) {
      next(err)
    }
  })

  router.get("/broken", async (_req, res, next) => {
    try {
      const links = await checker.getBrokenLinks()
      res.json(links)
    } catch (err) {
      next(err)
    }
  })

  return router
}
