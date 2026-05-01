-- Add inbound email routing to programs
ALTER TABLE "programs" ADD COLUMN "inbound_email_address" TEXT;
ALTER TABLE "programs" ADD COLUMN "inbound_sender_allowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE UNIQUE INDEX "programs_inbound_email_address_key" ON "programs"("inbound_email_address");

-- Add inbound email provenance + dedupe to evidences
ALTER TABLE "evidences" ADD COLUMN "raw_headers" TEXT;
ALTER TABLE "evidences" ADD COLUMN "raw_mime" TEXT;
ALTER TABLE "evidences" ADD COLUMN "inbound_message_id" TEXT;
CREATE UNIQUE INDEX "evidences_inbound_message_id_key" ON "evidences"("inbound_message_id");

-- Backfill RLS policies for tables that were missing them
ALTER TABLE extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitment_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "extraction_jobs_select" ON extraction_jobs
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
CREATE POLICY "extraction_jobs_insert" ON extraction_jobs
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
CREATE POLICY "extraction_jobs_update" ON extraction_jobs
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "commitment_terms_select" ON commitment_terms
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
CREATE POLICY "commitment_terms_insert" ON commitment_terms
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
CREATE POLICY "commitment_terms_update" ON commitment_terms
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));
CREATE POLICY "commitment_terms_delete" ON commitment_terms
  FOR DELETE USING (public.is_org_writer(public.program_org_id(program_id)));
