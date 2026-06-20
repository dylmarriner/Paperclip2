import { type Db, crawledLinks, crawledPages, redirectRules } from "@paperclipai/db"
import { eq, inArray } from "drizzle-orm"
import { JSDOM } from "jsdom"
import { logger } from "../middleware/logger.js"

export interface VerifyResult {
  success: boolean
  status: number
  error?: string
}

export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10_000,
}

class TransientHttpError extends Error {
  constructor(status: number, url: string) {
    super(`Transient status ${status} for ${url}`)
    this.name = "TransientHttpError"
  }
}

function isTransientError(error: unknown): boolean {
  if (error instanceof TransientHttpError) return true
  const msg = error instanceof Error ? error.message : String(error)
  if (msg.includes("abort") || msg.includes("timeout") || msg.includes("Timeout") || msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed")) {
    return true
  }
  return false
}

function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY, ...options }

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts && isTransientError(err)) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
        logger.warn({ err, attempt, maxAttempts, delayMs: delay }, "Transient error, retrying")
        await new Promise((r) => setTimeout(r, delay))
      } else {
        throw err
      }
    }
  }

  throw lastError
}

export interface RedirectRuleRow {
  id: string
  sourceUrl: string
  targetUrl: string
  statusCode: number
  description: string | null
  isActive: boolean
  lastCheckedAt: string | null
  lastCheckResult: string | null
}

export interface ExtractedLink {
  url: string
  linkText: string
  isInternal: boolean
}

export interface CrawlResult {
  pageId: string
  url: string
  title: string | null
  httpStatus: number | null
  links: CrawledLinkResult[]
  error: string | null
}

export interface CrawledLinkResult {
  url: string
  linkText: string | null
  isInternal: boolean
  httpStatus: number | null
  isBroken: boolean | null
  error: string | null
}

function getOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).href
  } catch {
    return null
  }
}

interface RobotsRule {
  path: string
  isWildcard: boolean
  isAllow: boolean
}

interface RobotsRecord {
  userAgents: string[]
  rules: RobotsRule[]
  crawlDelay: number | null
}

class RobotsTxt {
  private records: RobotsRecord[] = []

  constructor(content: string) {
    this.parse(content)
  }

  private parse(content: string): void {
    const lines = content.split("\n")
    let currentRecord: RobotsRecord | null = null

    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith("#")) continue

      const colonIdx = line.indexOf(":")
      if (colonIdx === -1) continue

      const field = line.slice(0, colonIdx).trim().toLowerCase()
      const value = line.slice(colonIdx + 1).trim()

      if (field === "user-agent") {
        currentRecord = { userAgents: [value.toLowerCase()], rules: [], crawlDelay: null }
        this.records.push(currentRecord)
      } else if (currentRecord) {
        if (field === "disallow") {
          if (value === "") continue
          currentRecord.rules.push({ path: value, isWildcard: value.includes("*"), isAllow: false })
        } else if (field === "allow") {
          if (value === "") continue
          currentRecord.rules.push({ path: value, isWildcard: value.includes("*"), isAllow: true })
        } else if (field === "crawl-delay") {
          const delay = Number.parseFloat(value)
          if (!Number.isNaN(delay) && delay >= 0) {
            currentRecord.crawlDelay = delay
          }
        }
      }
    }
  }

  isAllowed(url: string, userAgent: string): boolean {
    const path = new URL(url).pathname
    const ua = userAgent.toLowerCase()

    const record = this.findRecord(ua)
    if (!record) return true

    let allowed = true
    let bestMatchLen = -1

    for (const rule of record.rules) {
      if (this.pathMatches(path, rule.path)) {
        if (rule.path.length > bestMatchLen) {
          bestMatchLen = rule.path.length
          allowed = rule.isAllow
        }
      }
    }

    return allowed
  }

  getCrawlDelay(userAgent: string): number | null {
    const record = this.findRecord(userAgent.toLowerCase())
    return record?.crawlDelay ?? null
  }

  private findRecord(ua: string): RobotsRecord | null {
    for (const record of this.records) {
      if (record.userAgents.some((rUA) => rUA === ua)) return record
    }
    for (const record of this.records) {
      if (record.userAgents.includes("*")) return record
    }
    return null
  }

  private pathMatches(path: string, pattern: string): boolean {
    if (!pattern.includes("*")) {
      return path.startsWith(pattern)
    }

    const parts = pattern.split("*")
    let remaining = path
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (i === 0) {
        if (!remaining.startsWith(part)) return false
        remaining = remaining.slice(part.length)
      } else {
        const idx = remaining.indexOf(part)
        if (idx === -1) return false
        remaining = remaining.slice(idx + part.length)
      }
    }
    return true
  }
}

class CrawlRateLimiter {
  private lastRequest: Map<string, number> = new Map()

  constructor(private defaultDelayMs = 1000) {}

  async throttle(origin: string): Promise<void> {
    const now = Date.now()
    const last = this.lastRequest.get(origin) ?? 0
    const elapsed = now - last

    if (elapsed < this.defaultDelayMs) {
      await new Promise((r) => setTimeout(r, this.defaultDelayMs - elapsed))
    }

    this.lastRequest.set(origin, Date.now())
  }

  setDefaultDelay(delayMs: number): void {
    this.defaultDelayMs = delayMs
  }

  getDefaultDelay(): number {
    return this.defaultDelayMs
  }
}

export { RobotsTxt, CrawlRateLimiter }

export interface CrawlOptions {
  requestDelayMs?: number
  respectRobotsTxt?: boolean
  checkExternalLinks?: boolean
}

export class LinkCheckerService {
  constructor(private db: Db) {}

  private externalLinkCache: Map<string, { status: number; error: string | null; checkedAt: number }> = new Map()
  private externalRateLimiter: CrawlRateLimiter = new CrawlRateLimiter(2000)
  private readonly EXTERNAL_CACHE_TTL = 300_000
  private readonly EXTERNAL_REQUEST_TIMEOUT = 10_000

  async verifyUrl(
    url: string,
    expectedStatus = 200,
    redirectExpected = false,
    expectedLocation?: string,
  ): Promise<VerifyResult> {
    const attempt = async (): Promise<VerifyResult> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(url, {
        method: "GET",
        redirect: redirectExpected ? "manual" : "follow",
        signal: controller.signal,
        headers: { "User-Agent": this.USER_AGENT },
      })

      clearTimeout(timeout)

      if (redirectExpected) {
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location")
          const normalizedLocation = location?.replace(/\/$/, "")
          const normalizedExpected = expectedLocation?.replace(/\/$/, "")

          if (expectedLocation && normalizedLocation !== normalizedExpected) {
            return {
              success: false,
              status: response.status,
              error: `Expected redirect to ${expectedLocation}, got ${location}`,
            }
          }
          return { success: true, status: response.status }
        }
        if (isTransientStatus(response.status)) {
          throw new TransientHttpError(response.status, url)
        }
        return { success: false, status: response.status, error: `Expected redirect, got status ${response.status}` }
      }

      if (response.status !== expectedStatus) {
        if (isTransientStatus(response.status)) {
          throw new TransientHttpError(response.status, url)
        }
        return {
          success: false,
          status: response.status,
          error: `Expected status ${expectedStatus}, got ${response.status}`,
        }
      }

      return { success: true, status: response.status }
    }

    try {
      return await withRetry(attempt, { maxAttempts: 3, baseDelayMs: 1000 })
    } catch (error) {
      logger.error({ err: error, url }, "Link check failed after retries")
      return { success: false, status: 0, error: error instanceof Error ? error.message : "Unknown error" }
    }
  }

  async headUrl(url: string): Promise<VerifyResult> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.EXTERNAL_REQUEST_TIMEOUT)
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": this.USER_AGENT },
      })
      clearTimeout(timeout)
      if (response.status >= 400) {
        return { success: false, status: response.status, error: `HTTP ${response.status}` }
      }
      return { success: true, status: response.status }
    } catch (error) {
      return { success: false, status: 0, error: error instanceof Error ? error.message : "Unknown error" }
    }
  }

  async checkAllRedirectRules(): Promise<{
    checked: number
    passed: number
    failed: number
    details: Array<{
      id: string
      sourceUrl: string
      targetUrl: string
      statusCode: number
      success: boolean
      error: string | null
    }>
  }> {
    const rules = await this.db.select().from(redirectRules).where(eq(redirectRules.isActive, true))

    let passed = 0
    const details: Array<{
      id: string
      sourceUrl: string
      targetUrl: string
      statusCode: number
      success: boolean
      error: string | null
    }> = []

    for (const rule of rules) {
      const result = await this.verifyUrl(rule.sourceUrl, rule.statusCode, true, rule.targetUrl)
      const now = new Date()

      await this.db
        .update(redirectRules)
        .set({
          lastCheckedAt: now,
          lastCheckResult: result.success ? "success" : (result.error ?? "unknown_error"),
        })
        .where(eq(redirectRules.id, rule.id))

      details.push({
        id: rule.id,
        sourceUrl: rule.sourceUrl,
        targetUrl: rule.targetUrl,
        statusCode: rule.statusCode,
        success: result.success,
        error: result.error ?? null,
      })

      if (result.success) {
        passed++
      } else {
        logger.error({ url: rule.sourceUrl, target: rule.targetUrl, error: result.error }, "Broken redirect detected")
      }
    }

    const failed = rules.length - passed
    return { checked: rules.length, passed, failed, details }
  }

  async getActiveRules(): Promise<RedirectRuleRow[]> {
    const rules = await this.db
      .select()
      .from(redirectRules)
      .where(eq(redirectRules.isActive, true))
      .orderBy(redirectRules.sourceUrl)

    return rules.map((r) => ({
      id: r.id,
      sourceUrl: r.sourceUrl,
      targetUrl: r.targetUrl,
      statusCode: r.statusCode,
      description: r.description,
      isActive: r.isActive,
      lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
      lastCheckResult: r.lastCheckResult,
    }))
  }

  async getAllRules(): Promise<RedirectRuleRow[]> {
    const rules = await this.db.select().from(redirectRules).orderBy(redirectRules.sourceUrl)

    return rules.map((r) => ({
      id: r.id,
      sourceUrl: r.sourceUrl,
      targetUrl: r.targetUrl,
      statusCode: r.statusCode,
      description: r.description,
      isActive: r.isActive,
      lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
      lastCheckResult: r.lastCheckResult,
    }))
  }

  private robotsCache: Map<string, { robots: RobotsTxt; fetchedAt: number }> = new Map()
  private rateLimiter: CrawlRateLimiter = new CrawlRateLimiter(1000)

  private readonly USER_AGENT = "Paperclip-LinkChecker/1.0"
  private readonly ROBOTS_CACHE_TTL = 3600_000

  private async fetchRobotsTxt(origin: string): Promise<RobotsTxt | null> {
    const cached = this.robotsCache.get(origin)
    if (cached && Date.now() - cached.fetchedAt < this.ROBOTS_CACHE_TTL) {
      return cached.robots
    }

    try {
      const response = await fetch(`${origin}/robots.txt`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) {
        this.robotsCache.set(origin, { robots: new RobotsTxt(""), fetchedAt: Date.now() })
        return null
      }
      const text = await response.text()
      const robots = new RobotsTxt(text)
      this.robotsCache.set(origin, { robots, fetchedAt: Date.now() })
      return robots
    } catch {
      this.robotsCache.set(origin, { robots: new RobotsTxt(""), fetchedAt: Date.now() })
      return null
    }
  }

  async fetchPageHtml(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ html: string; status: number } | { error: string }> {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal,
        headers: { "User-Agent": this.USER_AGENT },
      })
      const html = await response.text()
      return { html, status: response.status }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unknown error" }
    }
  }

  extractLinksFromHtml(html: string, baseUrl: string): { title: string | null; links: ExtractedLink[] } {
    const dom = new JSDOM(html, { url: baseUrl })
    const doc = dom.window.document
    const title = doc.querySelector("title")?.textContent ?? null

    const baseOrigin = getOrigin(baseUrl)
    const anchorElements = doc.querySelectorAll("a[href]")
    const seen = new Set<string>()
    const links: ExtractedLink[] = []

    for (const anchor of anchorElements) {
      const href = anchor.getAttribute("href")
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue

      const resolved = resolveUrl(href, baseUrl)
      if (!resolved) continue
      if (seen.has(resolved)) continue
      seen.add(resolved)

      const linkOrigin = getOrigin(resolved)
      const isInternal = baseOrigin !== null && linkOrigin === baseOrigin
      const linkText = (anchor.textContent ?? "").trim().slice(0, 500)

      links.push({ url: resolved, linkText, isInternal })
    }

    return { title, links }
  }

  async crawlSinglePage(
    url: string,
  ): Promise<{ title: string | null; links: ExtractedLink[]; httpStatus: number | null; error: string | null }> {
    const result = await this.fetchPageHtml(url)
    if ("error" in result) {
      return { title: null, links: [], httpStatus: null, error: result.error }
    }
    const parsed = this.extractLinksFromHtml(result.html, url)
    return { title: parsed.title, links: parsed.links, httpStatus: result.status, error: null }
  }

  async crawlAndCheckLinks(
    startUrl: string,
    maxDepth = 2,
    maxPages = 50,
    optionsOrCheckExternal?: CrawlOptions | boolean,
  ): Promise<CrawlResult[]> {
    const options: CrawlOptions =
      typeof optionsOrCheckExternal === "boolean"
        ? { checkExternalLinks: optionsOrCheckExternal }
        : (optionsOrCheckExternal ?? {})

    const visited = new Set<string>()
    const results: CrawlResult[] = []
    const baseOrigin = getOrigin(startUrl)
    if (!baseOrigin) {
      logger.error({ url: startUrl }, "Invalid start URL for crawling")
      return []
    }

    const checkExternal = options.checkExternalLinks ?? false
    const respectRobots = options.respectRobotsTxt ?? true
    if (options.requestDelayMs !== undefined) {
      this.rateLimiter.setDefaultDelay(options.requestDelayMs)
    }

    let robotsTxt: RobotsTxt | null = null
    if (respectRobots) {
      robotsTxt = await this.fetchRobotsTxt(baseOrigin)
      if (robotsTxt) {
        const delay = robotsTxt.getCrawlDelay(this.USER_AGENT)
        if (delay !== null) {
          this.rateLimiter.setDefaultDelay(Math.max(this.rateLimiter.getDefaultDelay(), delay * 1000))
        }
      }
    }

    const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }]

    while (queue.length > 0 && visited.size < maxPages) {
      const { url, depth } = queue.shift()!
      if (visited.has(url)) continue

      if (respectRobots && robotsTxt && !robotsTxt.isAllowed(url, this.USER_AGENT)) {
        logger.info({ url }, "Skipping URL blocked by robots.txt")
        continue
      }

      visited.add(url)

      await this.rateLimiter.throttle(baseOrigin)

      const now = new Date()

      const [page] = await this.db.insert(crawledPages).values({ url, crawlStartedAt: now }).returning()

      const crawlResult = await this.crawlSinglePage(url)

      const linkResults: CrawledLinkResult[] = []

      for (const link of crawlResult.links) {
        const shouldCheck = link.isInternal || checkExternal
        let verifyResult = null
        if (shouldCheck) {
          if (link.isInternal) {
            await this.rateLimiter.throttle(baseOrigin)
            verifyResult = await this.verifyUrl(link.url, 200)
          } else {
            const cached = this.externalLinkCache.get(link.url)
            if (cached && Date.now() - cached.checkedAt < this.EXTERNAL_CACHE_TTL) {
              verifyResult = {
                success: cached.status >= 200 && cached.status < 400,
                status: cached.status,
                error: cached.error ?? undefined,
              }
            } else {
              const linkOrigin = getOrigin(link.url)
              if (linkOrigin) await this.externalRateLimiter.throttle(linkOrigin)
              verifyResult = await this.headUrl(link.url)
              this.externalLinkCache.set(link.url, {
                status: verifyResult.status,
                error: verifyResult.error ?? null,
                checkedAt: Date.now(),
              })
            }
          }
        }
        const linkResult: CrawledLinkResult = {
          url: link.url,
          linkText: link.linkText,
          isInternal: link.isInternal,
          httpStatus: verifyResult?.status ?? null,
          isBroken: verifyResult ? !verifyResult.success : null,
          error: verifyResult?.error ?? null,
        }
        linkResults.push(linkResult)

        await this.db.insert(crawledLinks).values({
          pageId: page.id,
          url: link.url,
          linkText: link.linkText,
          httpStatus: linkResult.httpStatus,
          isInternal: link.isInternal,
          isBroken: linkResult.isBroken,
          checkedAt: new Date(),
          error: linkResult.error,
        })
      }

      await this.db
        .update(crawledPages)
        .set({
          title: crawlResult.title,
          httpStatus: crawlResult.httpStatus,
          crawlCompletedAt: new Date(),
          error: crawlResult.error,
        })
        .where(eq(crawledPages.id, page.id))

      results.push({
        pageId: page.id,
        url,
        title: crawlResult.title,
        httpStatus: crawlResult.httpStatus,
        links: linkResults,
        error: crawlResult.error,
      })

      if (depth < maxDepth) {
        for (const link of crawlResult.links) {
          if (link.isInternal && !visited.has(link.url) && !queue.some((q) => q.url === link.url)) {
            if (respectRobots && robotsTxt && !robotsTxt.isAllowed(link.url, this.USER_AGENT)) {
              continue
            }
            queue.push({ url: link.url, depth: depth + 1 })
          }
        }
      }
    }

    logger.info(
      { startUrl, pagesCrawled: results.length, totalLinks: results.reduce((s, r) => s + r.links.length, 0) },
      "Page crawl completed",
    )

    return results
  }

  async getCrawlResults(limit = 50): Promise<CrawlResult[]> {
    const pages = await this.db.select().from(crawledPages).orderBy(crawledPages.createdAt).limit(limit)

    const results: CrawlResult[] = []

    for (const page of pages) {
      const links = await this.db.select().from(crawledLinks).where(eq(crawledLinks.pageId, page.id))

      results.push({
        pageId: page.id,
        url: page.url,
        title: page.title,
        httpStatus: page.httpStatus,
        links: links.map((l) => ({
          url: l.url,
          linkText: l.linkText,
          isInternal: l.isInternal,
          httpStatus: l.httpStatus,
          isBroken: l.isBroken,
          error: l.error,
        })),
        error: page.error,
      })
    }

    return results
  }

  async getBrokenLinks(limit = 100): Promise<CrawledLinkResult[]> {
    const links = await this.db.select().from(crawledLinks).where(eq(crawledLinks.isBroken, true)).limit(limit)

    return links.map((l) => ({
      url: l.url,
      linkText: l.linkText,
      isInternal: l.isInternal,
      httpStatus: l.httpStatus,
      isBroken: l.isBroken,
      error: l.error,
    }))
  }
}
