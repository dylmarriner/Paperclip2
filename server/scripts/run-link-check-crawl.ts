import type { Db } from "@paperclipai/db"
import { LinkCheckerService } from "../src/services/link-checker.js"

async function main() {
  const url = process.argv[2] || "http://localhost:3100"
  const depth = Number.parseInt(process.argv[3] || "1", 10)
  const maxPages = Number.parseInt(process.argv[4] || "20", 10)

  if (!process.argv[2]) {
    console.log("Usage: tsx scripts/run-link-check-crawl.ts <start-url> [max-depth] [max-pages]")
    console.log("Example: tsx scripts/run-link-check-crawl.ts https://docs.paperclip.ing/ 2 50")
    process.exit(1)
  }

  const mockDb = createMockDb()
  const checker = new LinkCheckerService(mockDb as unknown as Db)

  console.log(`[link-check] Starting crawl of: ${url}`)
  console.log(`[link-check] Depth: ${depth}, Max pages: ${maxPages}`)
  console.log("")

  const startTime = Date.now()

  const results = await checker.crawlAndCheckLinks(url, depth, maxPages, {
    checkExternalLinks: true,
    respectRobotsTxt: false,
    requestDelayMs: 500,
  })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  const totalLinks = results.reduce((s, r) => s + r.links.length, 0)
  const brokenLinks = results.filter((r) => r.links.some((l) => l.isBroken))
  const brokenLinkCount = results.reduce((s, r) => s + r.links.filter((l) => l.isBroken).length, 0)

  console.log(`[link-check] Finished in ${elapsed}s`)
  console.log(`[link-check] Pages crawled: ${results.length}`)
  console.log(`[link-check] Total links checked: ${totalLinks}`)
  console.log(`[link-check] Broken links found: ${brokenLinkCount}`)

  if (brokenLinkCount > 0) {
    console.log("\n--- Broken Links ---")
    for (const page of results) {
      const broken = page.links.filter((l) => l.isBroken)
      for (const link of broken) {
        console.log(`  [BROKEN] ${link.url} -> ${link.error || "Unknown error"}`)
        console.log(`           Found on: ${page.url}`)
      }
    }
  }

  console.log("\n--- Crawl Summary ---")
  for (const page of results) {
    const goodLinks = page.links.filter((l) => !l.isBroken).length
    const badLinks = page.links.filter((l) => l.isBroken).length
    const skipped = page.links.filter((l) => l.isBroken === null).length
    const status = page.httpStatus ? `HTTP ${page.httpStatus}` : "ERROR"
    console.log(`  ${page.url} (${status}) - ${goodLinks} ok, ${badLinks} broken, ${skipped} skipped`)
  }
}

function createMockDb() {
  let pageCounter = 0
  const store = { pages: new Map(), links: new Map() }
  return {
    insert: (_table: any) => ({
      values: (_vals: any) => ({
        returning: () => {
          const id = `mock-page-${++pageCounter}`
          store.pages.set(id, _vals)
          return [{ id }]
        },
      }),
    }),
    update: (_table: any) => ({
      set: (_vals: any) => ({
        where: (_cond: any) => {
          // noop
        },
      }),
    }),
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: () => Promise.resolve([]),
        }),
        limit: () => Promise.resolve([]),
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  }
}

main().catch((err) => {
  console.error("[link-check] Fatal error:", err)
  process.exit(1)
})
