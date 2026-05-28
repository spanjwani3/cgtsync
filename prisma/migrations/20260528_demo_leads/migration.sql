-- ═══════════════════════════════════════════════════════════════════
-- Gated demo videos: lead capture + view-session engagement tracking
-- Platform-level marketing data (no org/tenant scope). RLS is enabled
-- with no policies so direct PostgREST/anon access is denied; Prisma
-- (postgres superuser) bypasses RLS and handles all reads/writes.
-- ═══════════════════════════════════════════════════════════════════

-- ─── demo_leads ─────────────────────────────────────────────
CREATE TABLE "demo_leads" (
  "id"         uuid NOT NULL DEFAULT gen_random_uuid(),
  "email"      text NOT NULL,
  "name"       text,
  "company"    text,
  "demo_slug"  text NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "demo_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "demo_leads_demo_slug_email_key" ON "demo_leads" ("demo_slug", "email");
CREATE INDEX "demo_leads_demo_slug_created_at_idx" ON "demo_leads" ("demo_slug", "created_at");
CREATE INDEX "demo_leads_email_idx" ON "demo_leads" ("email");

-- ─── demo_views ─────────────────────────────────────────────
CREATE TABLE "demo_views" (
  "id"                uuid NOT NULL DEFAULT gen_random_uuid(),
  "lead_id"           uuid NOT NULL,
  "demo_slug"         text NOT NULL,
  "email"             text NOT NULL,
  "watched_seconds"   integer NOT NULL DEFAULT 0,
  "max_position_sec"  integer NOT NULL DEFAULT 0,
  "duration_sec"      integer,
  "completed"         boolean NOT NULL DEFAULT false,
  "started_at"        timestamptz NOT NULL DEFAULT now(),
  "last_heartbeat_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "demo_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "demo_views_lead_id_fkey" FOREIGN KEY ("lead_id")
    REFERENCES "demo_leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "demo_views_demo_slug_started_at_idx" ON "demo_views" ("demo_slug", "started_at");
CREATE INDEX "demo_views_lead_id_idx" ON "demo_views" ("lead_id");

-- ─── RLS: deny direct access; Prisma superuser bypasses ─────
ALTER TABLE "demo_leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "demo_views" ENABLE ROW LEVEL SECURITY;
