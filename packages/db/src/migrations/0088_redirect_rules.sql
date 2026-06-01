CREATE TABLE IF NOT EXISTS "redirect_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_url" text NOT NULL,
	"target_url" text NOT NULL,
	"status_code" integer DEFAULT 302 NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "redirect_rules_active_idx" ON "redirect_rules" ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "redirect_rules_source_url_idx" ON "redirect_rules" ("source_url");
