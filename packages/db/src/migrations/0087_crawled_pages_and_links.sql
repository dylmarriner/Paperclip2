CREATE TABLE IF NOT EXISTS "crawled_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"http_status" integer,
	"crawl_started_at" timestamp with time zone,
	"crawl_completed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crawled_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL REFERENCES "crawled_pages"("id") ON DELETE cascade,
	"url" text NOT NULL,
	"link_text" text,
	"http_status" integer,
	"is_internal" boolean DEFAULT true NOT NULL,
	"is_broken" boolean,
	"checked_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawled_pages_url_idx" ON "crawled_pages" ("url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawled_links_page_id_idx" ON "crawled_links" ("page_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawled_links_broken_idx" ON "crawled_links" ("is_broken");
