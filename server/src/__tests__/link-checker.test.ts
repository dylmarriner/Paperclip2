import { type Server, createServer } from "node:http"
import type { Db } from "@paperclipai/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { LinkCheckerService } from "../services/link-checker.js"

const mockDb = {} as unknown as Db

function startTestServer(handler?: (req: any, res: any) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(
      handler ??
        ((req, res) => {
          const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

          if (url.pathname === "/ok") {
            res.writeHead(200, { "Content-Type": "text/plain" })
            res.end("OK")
          } else if (url.pathname === "/not-found") {
            res.writeHead(404, { "Content-Type": "text/plain" })
            res.end("Not Found")
          } else if (url.pathname === "/redirect") {
            const target = url.searchParams.get("to") ?? "/ok"
            res.writeHead(302, { Location: target })
            res.end()
          } else if (url.pathname === "/permanent-redirect") {
            res.writeHead(301, { Location: "/ok" })
            res.end()
          } else {
            res.writeHead(200, { "Content-Type": "text/plain" })
            res.end("Default OK")
          }
        }),
    )

    server.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"))
        return
      }
      resolve({ server, port: addr.port })
    })

    server.on("error", reject)
  })
}

function createMockDb() {
  let pageCounter = 0
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: `page-${++pageCounter}` }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as unknown as Db
}

describe("LinkCheckerService", () => {
  let testServer: Server
  let testPort: number

  beforeAll(async () => {
    const result = await startTestServer()
    testServer = result.server
    testPort = result.port
  })

  afterAll(() => {
    testServer.close()
  })

  it("verifies reachable URL", async () => {
    const service = new LinkCheckerService(mockDb)
    const result = await service.verifyUrl(`http://localhost:${testPort}/ok`, 200)
    expect(result.success).toBe(true)
    expect(result.status).toBe(200)
  })

  it("detects incorrect redirect URL", async () => {
    const service = new LinkCheckerService(mockDb)
    const result = await service.verifyUrl(
      `http://localhost:${testPort}/redirect?to=/ok`,
      302,
      true,
      "http://wrong-target.com/",
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain("Expected redirect to")
  })

  it("detects correct redirect", async () => {
    const service = new LinkCheckerService(mockDb)
    const result = await service.verifyUrl(`http://localhost:${testPort}/redirect?to=/ok`, 302, true, "/ok")
    expect(result.success).toBe(true)
    expect(result.status).toBe(302)
  })

  it("detects incorrect status code", async () => {
    const service = new LinkCheckerService(mockDb)
    const result = await service.verifyUrl(`http://localhost:${testPort}/not-found`, 200)
    expect(result.success).toBe(false)
    expect(result.error).toContain("Expected status 200")
  })

  it("follows redirect by default and returns final status", async () => {
    const service = new LinkCheckerService(mockDb)
    const result = await service.verifyUrl(`http://localhost:${testPort}/redirect?to=/ok`, 200)
    expect(result.success).toBe(true)
    expect(result.status).toBe(200)
  })

  it("handles unreachable URL gracefully", async () => {
    const service = new LinkCheckerService(mockDb)
    const result = await service.verifyUrl("http://localhost:1/nonexistent", 200)
    expect(result.success).toBe(false)
    expect(result.status).toBe(0)
    expect(result.error).toBeTruthy()
  })
})

describe("withRetry", () => {
  it("succeeds on first attempt when function succeeds", async () => {
    const { withRetry } = await import("../services/link-checker.js")
    const fn = vi.fn().mockResolvedValue("ok")
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries on transient errors and succeeds", async () => {
    const { withRetry } = await import("../services/link-checker.js")
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue("ok")
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50 })
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("fails after exhausting retries on persistent transient error", async () => {
    const { withRetry } = await import("../services/link-checker.js")
    const fn = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"))
    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 10 })).rejects.toThrow("ETIMEDOUT")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("does not retry on non-transient errors", async () => {
    const { withRetry } = await import("../services/link-checker.js")
    const fn = vi.fn().mockRejectedValue(new Error("Not found"))
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toThrow("Not found")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries on transient HTTP 5xx status via verifyUrl", async () => {
    const { LinkCheckerService } = await import("../services/link-checker.js")
    let attemptCount = 0
    const { server, port } = await startTestServer((_req, res) => {
      attemptCount++
      if (attemptCount < 3) {
        res.writeHead(503, { "Content-Type": "text/plain" })
        res.end("Service Unavailable")
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" })
        res.end("OK")
      }
    })
    try {
      const service = new LinkCheckerService(mockDb)
      const result = await service.verifyUrl(`http://localhost:${port}/ok`, 200)
      expect(result.success).toBe(true)
      expect(attemptCount).toBe(3)
    } finally {
      server.close()
    }
  }, 15000)
})

describe("external link verification", () => {
  let siteServer: Server
  let extServer: Server
  let sitePort: number
  let extPort: number

  beforeAll(async () => {
    const ext = await startTestServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      if (url.pathname === "/api/data") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ data: "ok" }))
      } else {
        res.writeHead(404)
        res.end("Not Found")
      }
    })
    extServer = ext.server
    extPort = ext.port

    const site = await startTestServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(`<html><body>
        <a href="/internal-page">Internal</a>
        <a href="http://localhost:${extPort}/api/data">External OK</a>
        <a href="http://localhost:${extPort}/broken">External Broken</a>
      </body></html>`)
    })
    siteServer = site.server
    sitePort = site.port
  })

  afterAll(() => {
    siteServer?.close()
    extServer?.close()
  })

  it("verifies external links when checkExternalLinks is true", async () => {
    const db = createMockDb()
    const service = new LinkCheckerService(db)
    const results = await service.crawlAndCheckLinks(`http://localhost:${sitePort}`, 0, 10, true)

    expect(results).toHaveLength(1)
    const externalLinks = results[0].links.filter((l) => !l.isInternal)
    expect(externalLinks).toHaveLength(2)

    const okLink = externalLinks.find((l) => l.url.includes("/api/data"))
    expect(okLink).toBeDefined()
    expect(okLink?.httpStatus).toBe(200)
    expect(okLink?.isBroken).toBe(false)

    const brokenLink = externalLinks.find((l) => l.url.includes("/broken"))
    expect(brokenLink).toBeDefined()
    expect(brokenLink?.isBroken).toBe(true)
  })

  it("skips external link verification when checkExternalLinks is false", async () => {
    const db = createMockDb()
    const service = new LinkCheckerService(db)
    const results = await service.crawlAndCheckLinks(`http://localhost:${sitePort}`, 0, 10, false)

    expect(results).toHaveLength(1)
    const externalLinks = results[0].links.filter((l) => !l.isInternal)
    expect(externalLinks).toHaveLength(2)
    for (const link of externalLinks) {
      expect(link.httpStatus).toBeNull()
      expect(link.isBroken).toBeNull()
      expect(link.error).toBeNull()
    }
  })
})
