import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const crawledPages = pgTable(
  "crawled_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    title: text("title"),
    httpStatus: integer("http_status"),
    crawlStartedAt: timestamp("crawl_started_at", { withTimezone: true }),
    crawlCompletedAt: timestamp("crawl_completed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    urlIdx: index("crawled_pages_url_idx").on(table.url),
  }),
)
