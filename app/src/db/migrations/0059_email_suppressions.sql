-- Forward-only. Apply before deploying the app; older app and worker versions ignore the table.
CREATE TABLE IF NOT EXISTS "email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"diagnostic" text,
	"bounce_count" integer DEFAULT 1 NOT NULL,
	"first_bounced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_bounced_at" timestamp with time zone DEFAULT now() NOT NULL
);
