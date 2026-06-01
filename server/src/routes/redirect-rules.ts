import type { Db } from "@paperclipai/db"
import { redirectRules } from "@paperclipai/db"
import { eq } from "drizzle-orm"
import { Router } from "express"
import { LinkCheckerService } from "../services/link-checker.js"

export function redirectRuleRoutes(db: Db): Router {
  const router = Router()
  const checker = new LinkCheckerService(db)

  router.get("/", async (_req, res, next) => {
    try {
      const rules = await checker.getAllRules()
      res.json(rules)
    } catch (err) {
      next(err)
    }
  })

  router.post("/", async (req, res, next) => {
    try {
      const { sourceUrl, targetUrl, statusCode, description, isActive } = req.body
      if (!sourceUrl || !targetUrl) {
        res.status(400).json({ error: "sourceUrl and targetUrl are required" })
        return
      }

      const [rule] = await db
        .insert(redirectRules)
        .values({
          sourceUrl,
          targetUrl,
          statusCode: statusCode ?? 302,
          description: description ?? null,
          isActive: isActive !== undefined ? isActive : true,
        })
        .returning()

      res.status(201).json(rule)
    } catch (err) {
      next(err)
    }
  })

  router.get("/:id", async (req, res, next) => {
    try {
      const [rule] = await db.select().from(redirectRules).where(eq(redirectRules.id, req.params.id))

      if (!rule) {
        res.status(404).json({ error: "Redirect rule not found" })
        return
      }

      res.json(rule)
    } catch (err) {
      next(err)
    }
  })

  router.put("/:id", async (req, res, next) => {
    try {
      const { sourceUrl, targetUrl, statusCode, description, isActive } = req.body
      const updates: Record<string, unknown> = {}

      if (sourceUrl !== undefined) updates.sourceUrl = sourceUrl
      if (targetUrl !== undefined) updates.targetUrl = targetUrl
      if (statusCode !== undefined) updates.statusCode = statusCode
      if (description !== undefined) updates.description = description
      if (isActive !== undefined) updates.isActive = isActive

      const [rule] = await db.update(redirectRules).set(updates).where(eq(redirectRules.id, req.params.id)).returning()

      if (!rule) {
        res.status(404).json({ error: "Redirect rule not found" })
        return
      }

      res.json(rule)
    } catch (err) {
      next(err)
    }
  })

  router.delete("/:id", async (req, res, next) => {
    try {
      const [rule] = await db
        .delete(redirectRules)
        .where(eq(redirectRules.id, req.params.id))
        .returning({ id: redirectRules.id })

      if (!rule) {
        res.status(404).json({ error: "Redirect rule not found" })
        return
      }

      res.status(204).end()
    } catch (err) {
      next(err)
    }
  })

  router.post("/check", async (_req, res, next) => {
    try {
      const result = await checker.checkAllRedirectRules()
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  return router
}
