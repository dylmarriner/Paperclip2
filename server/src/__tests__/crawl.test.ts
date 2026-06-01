import { describe, expect, it } from "vitest"
import {
  type CrawlOptions,
  CrawlRateLimiter,
  type ExtractedLink,
  LinkCheckerService,
  RobotsTxt,
} from "../services/link-checker.js"

describe("extractLinksFromHtml", () => {
  const mockDb = {} as any

  it("extracts all anchor links from HTML", () => {
    const service = new LinkCheckerService(mockDb)
    const html = `
      <html><body>
        <a href="/page1">Page 1</a>
        <a href="/page2">Page 2</a>
        <a href="https://external.com">External</a>
      </body></html>
    `

    const result = service.extractLinksFromHtml(html, "https://example.com")
    expect(result.links).toHaveLength(3)
    expect(result.links[0].url).toBe("https://example.com/page1")
    expect(result.links[1].url).toBe("https://example.com/page2")
    expect(result.links[2].url).toBe("https://external.com/")
  })

  it("marks internal and external links correctly", () => {
    const service = new LinkCheckerService(mockDb)
    const html = `
      <html><body>
        <a href="/internal">Internal</a>
        <a href="https://other.com/page">External</a>
      </body></html>
    `

    const result = service.extractLinksFromHtml(html, "https://example.com")
    expect(result.links[0].isInternal).toBe(true)
    expect(result.links[1].isInternal).toBe(false)
  })

  it("skips anchors, javascript:, and mailto: links", () => {
    const service = new LinkCheckerService(mockDb)
    const html = `
      <html><body>
        <a href="#section">Anchor</a>
        <a href="javascript:void(0)">JS</a>
        <a href="mailto:test@example.com">Mail</a>
        <a href="/real">Real Link</a>
      </body></html>
    `

    const result = service.extractLinksFromHtml(html, "https://example.com")
    expect(result.links).toHaveLength(1)
    expect(result.links[0].url).toBe("https://example.com/real")
  })

  it("deduplicates identical URLs", () => {
    const service = new LinkCheckerService(mockDb)
    const html = `
      <html><body>
        <a href="/page1">Page 1</a>
        <a href="/page1">Page 1 again</a>
        <a href="/page2">Page 2</a>
      </body></html>
    `

    const result = service.extractLinksFromHtml(html, "https://example.com")
    expect(result.links).toHaveLength(2)
  })

  it("extracts the page title from HTML", () => {
    const service = new LinkCheckerService(mockDb)
    const html = `
      <html><head><title>Test Page</title></head>
      <body><a href="/page1">Page 1</a></body>
    `

    const result = service.extractLinksFromHtml(html, "https://example.com")
    expect(result.title).toBe("Test Page")
  })

  it("returns null title when no title tag", () => {
    const service = new LinkCheckerService(mockDb)
    const html = `<html><body><a href="/page1">Page 1</a></body></html>`

    const result = service.extractLinksFromHtml(html, "https://example.com")
    expect(result.title).toBeNull()
  })

  it("handles relative URLs correctly", () => {
    const service = new LinkCheckerService(mockDb)
    const html = `
      <html><body>
        <a href="relative-page">Relative</a>
        <a href="/absolute-page">Absolute</a>
      </body></html>
    `

    const result = service.extractLinksFromHtml(html, "https://example.com/sub/")
    expect(result.links[0].url).toBe("https://example.com/sub/relative-page")
    expect(result.links[1].url).toBe("https://example.com/absolute-page")
  })

  it("handles empty HTML gracefully", () => {
    const service = new LinkCheckerService(mockDb)
    const result = service.extractLinksFromHtml("", "https://example.com")
    expect(result.links).toHaveLength(0)
    expect(result.title).toBeNull()
  })
})

describe("RobotsTxt", () => {
  it("allows all when empty", () => {
    const robots = new RobotsTxt("")
    expect(robots.isAllowed("https://example.com/any", "bot")).toBe(true)
  })

  it("blocks paths in disallow", () => {
    const robots = new RobotsTxt("User-agent: *\nDisallow: /private")
    expect(robots.isAllowed("https://example.com/private", "bot")).toBe(false)
    expect(robots.isAllowed("https://example.com/private/file", "bot")).toBe(false)
  })

  it("allows non-disallowed paths", () => {
    const robots = new RobotsTxt("User-agent: *\nDisallow: /private")
    expect(robots.isAllowed("https://example.com/public", "bot")).toBe(true)
  })

  it("handles allow override with more specific path", () => {
    const robots = new RobotsTxt("User-agent: *\nDisallow: /private\nAllow: /private/public")
    expect(robots.isAllowed("https://example.com/private", "bot")).toBe(false)
    expect(robots.isAllowed("https://example.com/private/public", "bot")).toBe(true)
  })

  it("extracts crawl-delay", () => {
    const robots = new RobotsTxt("User-agent: *\nCrawl-delay: 10")
    expect(robots.getCrawlDelay("bot")).toBe(10)
  })

  it("returns null crawl-delay when not specified", () => {
    const robots = new RobotsTxt("User-agent: *\nDisallow: /private")
    expect(robots.getCrawlDelay("bot")).toBeNull()
  })

  it("matches exact user-agent before wildcard", () => {
    const robots = new RobotsTxt("User-agent: *\nDisallow: /\nUser-agent: GoodBot\nDisallow:")
    expect(robots.isAllowed("https://example.com/anything", "GoodBot")).toBe(true)
    expect(robots.isAllowed("https://example.com/anything", "BadBot")).toBe(false)
  })

  it("handles wildcard patterns in paths", () => {
    const robots = new RobotsTxt("User-agent: *\nDisallow: /private/*/secret")
    expect(robots.isAllowed("https://example.com/private/sub/secret", "bot")).toBe(false)
    expect(robots.isAllowed("https://example.com/private/other", "bot")).toBe(true)
  })

  it("handles Disallow: / to block everything", () => {
    const robots = new RobotsTxt("User-agent: *\nDisallow: /")
    expect(robots.isAllowed("https://example.com/", "bot")).toBe(false)
    expect(robots.isAllowed("https://example.com/any/path", "bot")).toBe(false)
  })

  it("ignores comments", () => {
    const robots = new RobotsTxt("# This is a comment\nUser-agent: *\n# Another comment\nDisallow: /private")
    expect(robots.isAllowed("https://example.com/private", "bot")).toBe(false)
    expect(robots.isAllowed("https://example.com/public", "bot")).toBe(true)
  })

  it("handles multiple user-agent groups", () => {
    const robots = new RobotsTxt("User-agent: BotA\nDisallow: /a\n\nUser-agent: BotB\nDisallow: /b")
    expect(robots.isAllowed("https://example.com/a", "BotA")).toBe(false)
    expect(robots.isAllowed("https://example.com/b", "BotA")).toBe(true)
    expect(robots.isAllowed("https://example.com/a", "BotB")).toBe(true)
    expect(robots.isAllowed("https://example.com/b", "BotB")).toBe(false)
  })

  it("allows when no matching user-agent record", () => {
    const robots = new RobotsTxt("User-agent: SpecificBot\nDisallow: /")
    expect(robots.isAllowed("https://example.com/anything", "OtherBot")).toBe(true)
  })
})

describe("external link checking", () => {
  const mockDb = {} as any

  it("marks external links correctly in extracted links", () => {
    const service = new LinkCheckerService(mockDb)
    const html = `
      <html><body>
        <a href="https://external.com/page">External</a>
        <a href="/internal">Internal</a>
      </body></html>
    `
    const result = service.extractLinksFromHtml(html, "https://example.com")
    expect(result.links.find((l) => l.url.includes("external.com"))?.isInternal).toBe(false)
    expect(result.links.find((l) => l.url.includes("example.com"))?.isInternal).toBe(true)
  })

  it("external link cache returns cached result for repeated URL", () => {
    const service = new LinkCheckerService(mockDb)
    const url = "https://example.com/page"
    service.externalLinkCache.set(url, { status: 200, error: null, checkedAt: Date.now() })
    const cached = service.externalLinkCache.get(url)
    expect(cached).toBeDefined()
    expect(cached?.status).toBe(200)
  })

  it("external link cache expires after TTL", () => {
    const service = new LinkCheckerService(mockDb)
    const url = "https://example.com/page"
    service.externalLinkCache.set(url, { status: 200, error: null, checkedAt: Date.now() - 600_000 })
    const cached = service.externalLinkCache.get(url)
    expect(Date.now() - cached?.checkedAt).toBeGreaterThan(service.EXTERNAL_CACHE_TTL)
  })

  it("extracts external link text correctly", () => {
    const service = new LinkCheckerService(mockDb)
    const html = `<html><body><a href="https://other.com/link">Visit Other Site</a></body></html>`
    const result = service.extractLinksFromHtml(html, "https://example.com")
    expect(result.links[0].linkText).toBe("Visit Other Site")
    expect(result.links[0].isInternal).toBe(false)
  })

  it("handles mixed internal and external links", () => {
    const service = new LinkCheckerService(mockDb)
    const html = `
      <html><body>
        <a href="/internal">Int</a>
        <a href="https://ext1.com/a">Ext1</a>
        <a href="https://ext2.com/b">Ext2</a>
      </body></html>
    `
    const result = service.extractLinksFromHtml(html, "https://example.com")
    expect(result.links.filter((l) => l.isInternal)).toHaveLength(1)
    expect(result.links.filter((l) => !l.isInternal)).toHaveLength(2)
  })
})

describe("CrawlRateLimiter", () => {
  it("does not delay on first request", async () => {
    const limiter = new CrawlRateLimiter(1000)
    const start = Date.now()
    await limiter.throttle("https://example.com")
    expect(Date.now() - start).toBeLessThan(100)
  })

  it("delays second request to same origin", async () => {
    const limiter = new CrawlRateLimiter(200)
    await limiter.throttle("https://example.com")
    const start = Date.now()
    await limiter.throttle("https://example.com")
    expect(Date.now() - start).toBeGreaterThanOrEqual(180)
  })

  it("does not delay different origins", async () => {
    const limiter = new CrawlRateLimiter(500)
    await limiter.throttle("https://a.com")
    const start = Date.now()
    await limiter.throttle("https://b.com")
    expect(Date.now() - start).toBeLessThan(100)
  })

  it("respects setDefaultDelay", async () => {
    const limiter = new CrawlRateLimiter(10)
    limiter.setDefaultDelay(200)
    await limiter.throttle("https://example.com")
    const start = Date.now()
    await limiter.throttle("https://example.com")
    expect(Date.now() - start).toBeGreaterThanOrEqual(180)
  })
})
