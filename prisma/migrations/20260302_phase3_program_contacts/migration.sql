-- Phase 3: Program Contacts migration
-- Adds program_contacts table for storing reusable contact information

-- 1. New enum type
CREATE TYPE "ContactType" AS ENUM ('CLIENT', 'INTERNAL', 'OTHER');

-- 2. Create program_contacts table
CREATE TABLE "program_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "title" TEXT,
    "organization_name" TEXT,
    "contact_type" "ContactType" NOT NULL DEFAULT 'CLIENT',
    "phone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "program_contacts_program_id_contact_type_idx" ON "program_contacts"("program_id", "contact_type");

-- 3. Foreign key constraints
ALTER TABLE "program_contacts" ADD CONSTRAINT "program_contacts_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_contacts" ADD CONSTRAINT "program_contacts_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Row Level Security
ALTER TABLE "program_contacts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "program_contacts_org_isolation" ON "program_contacts"
    USING ("org_id" = current_setting('app.current_org_id', true)::uuid);
