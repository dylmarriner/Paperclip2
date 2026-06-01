import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { crawledPages } from "./crawled_pages.js"

export const crawledLinks = pgTable(
  "crawled_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => crawledPages.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    linkText: text("link_text"),
    httpStatus: integer("http_status"),
    isInternal: boolean("is_internal").notNull().default(true),
    isBroken: boolean("is_broken"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pageIdIdx: index("crawled_links_page_id_idx").on(table.pageId),
    brokenIdx: index("crawled_links_broken_idx").on(table.isBroken),
  }),
)
