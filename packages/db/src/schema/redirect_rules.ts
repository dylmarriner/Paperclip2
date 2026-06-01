import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const redirectRules = pgTable(
  "redirect_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceUrl: text("source_url").notNull(),
    targetUrl: text("target_url").notNull(),
    statusCode: integer("status_code").notNull().default(302),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastCheckResult: text("last_check_result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    activeIdx: index("redirect_rules_active_idx").on(table.isActive),
    sourceUrlIdx: index("redirect_rules_source_url_idx").on(table.sourceUrl),
  }),
)
