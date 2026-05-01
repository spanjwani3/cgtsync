-- Phase 1 features migration

-- 1.1 Historical Evidence Backloading
ALTER TABLE "evidences" ADD COLUMN "original_date" TIMESTAMP(3);
ALTER TABLE "evidences" ADD COLUMN "is_backloaded" BOOLEAN NOT NULL DEFAULT false;

-- 1.2 CSV/Excel Import
CREATE TYPE "ImportTargetType" AS ENUM ('INVOICE', 'BASELINE', 'CONTRACT');

CREATE TABLE "import_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "target_type" "ImportTargetType" NOT NULL,
    "column_map" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_mappings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "import_mappings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "import_mappings_org_isolation" ON "import_mappings"
    USING ("org_id" = current_setting('app.current_org_id', true)::uuid);

-- 1.3 PM Assignment Badges
ALTER TABLE "programs" ADD COLUMN "assigned_pm_id" UUID;
ALTER TABLE "programs" ADD CONSTRAINT "programs_assigned_pm_id_fkey"
    FOREIGN KEY ("assigned_pm_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 1.4 Export Formatting - Org logo
ALTER TABLE "organizations" ADD COLUMN "logo_url" TEXT;

-- Add new EventAction values
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'EVIDENCE_BACKLOADED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'BULK_IMPORT';
