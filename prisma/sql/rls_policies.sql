-- ═══════════════════════════════════════════════════════════════════
-- CGT-Sync: Row Level Security Policies
-- Run this AFTER Prisma migrations in Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════

-- Helper: extract user id from Supabase JWT
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$ LANGUAGE sql STABLE;

-- Helper: check if current user is a member of an org
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: check if current user has a specific role in an org
CREATE OR REPLACE FUNCTION public.has_org_role(p_org_id uuid, p_role "OrgRole") RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org_id AND user_id = auth.uid() AND role = p_role
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: check if current user is admin or operator in an org
CREATE OR REPLACE FUNCTION public.is_org_writer(p_org_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org_id AND user_id = auth.uid() AND role IN ('ADMIN', 'OPERATOR')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: get org_id for a program
CREATE OR REPLACE FUNCTION public.program_org_id(p_program_id uuid) RETURNS uuid AS $$
  SELECT org_id FROM programs WHERE id = p_program_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─── Enable RLS ──────────────────────────────────────────────

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE baseline_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitment_terms ENABLE ROW LEVEL SECURITY;

-- ─── users ──────────────────────────────────────────────────

CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "users_insert_own" ON users
  FOR INSERT WITH CHECK (id = auth.uid());

-- ─── organizations ──────────────────────────────────────────

CREATE POLICY "orgs_select_member" ON organizations
  FOR SELECT USING (public.is_org_member(id));

CREATE POLICY "orgs_insert_any_authed" ON organizations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "orgs_update_admin" ON organizations
  FOR UPDATE USING (public.has_org_role(id, 'ADMIN'));

-- ─── org_members ────────────────────────────────────────────

CREATE POLICY "org_members_select_same_org" ON org_members
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_members_insert_admin" ON org_members
  FOR INSERT WITH CHECK (public.has_org_role(org_id, 'ADMIN'));

CREATE POLICY "org_members_update_admin" ON org_members
  FOR UPDATE USING (public.has_org_role(org_id, 'ADMIN'));

CREATE POLICY "org_members_delete_admin" ON org_members
  FOR DELETE USING (public.has_org_role(org_id, 'ADMIN'));

-- ─── programs ───────────────────────────────────────────────

CREATE POLICY "programs_select_member" ON programs
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "programs_insert_writer" ON programs
  FOR INSERT WITH CHECK (public.is_org_writer(org_id));

CREATE POLICY "programs_update_writer" ON programs
  FOR UPDATE USING (public.is_org_writer(org_id));

-- ─── baselines ──────────────────────────────────────────────

CREATE POLICY "baselines_select" ON baselines
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "baselines_insert" ON baselines
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "baselines_update" ON baselines
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

-- ─── baseline_clauses ───────────────────────────────────────

CREATE POLICY "clauses_select" ON baseline_clauses
  FOR SELECT USING (
    public.is_org_member(
      public.program_org_id(
        (SELECT program_id FROM baselines WHERE id = baseline_clauses.baseline_id)
      )
    )
  );

CREATE POLICY "clauses_insert" ON baseline_clauses
  FOR INSERT WITH CHECK (
    public.is_org_writer(
      public.program_org_id(
        (SELECT program_id FROM baselines WHERE id = baseline_clauses.baseline_id)
      )
    )
  );

CREATE POLICY "clauses_update" ON baseline_clauses
  FOR UPDATE USING (
    public.is_org_writer(
      public.program_org_id(
        (SELECT program_id FROM baselines WHERE id = baseline_clauses.baseline_id)
      )
    )
  );

-- ─── changes ────────────────────────────────────────────────

CREATE POLICY "changes_select" ON changes
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "changes_insert" ON changes
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "changes_update" ON changes
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

-- ─── invoices ───────────────────────────────────────────────

CREATE POLICY "invoices_select" ON invoices
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "invoices_insert" ON invoices
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "invoices_update" ON invoices
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

-- ─── invoice_line_items ─────────────────────────────────────

CREATE POLICY "line_items_select" ON invoice_line_items
  FOR SELECT USING (
    public.is_org_member(
      public.program_org_id(
        (SELECT program_id FROM invoices WHERE id = invoice_line_items.invoice_id)
      )
    )
  );

CREATE POLICY "line_items_insert" ON invoice_line_items
  FOR INSERT WITH CHECK (
    public.is_org_writer(
      public.program_org_id(
        (SELECT program_id FROM invoices WHERE id = invoice_line_items.invoice_id)
      )
    )
  );

CREATE POLICY "line_items_update" ON invoice_line_items
  FOR UPDATE USING (
    public.is_org_writer(
      public.program_org_id(
        (SELECT program_id FROM invoices WHERE id = invoice_line_items.invoice_id)
      )
    )
  );

-- ─── evidences ──────────────────────────────────────────────

CREATE POLICY "evidences_select" ON evidences
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "evidences_insert" ON evidences
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "evidences_update" ON evidences
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

-- ─── event_logs (append-only: select + insert only) ─────────

CREATE POLICY "event_logs_select" ON event_logs
  FOR SELECT USING (
    program_id IS NULL OR public.is_org_member(public.program_org_id(program_id))
  );

CREATE POLICY "event_logs_insert" ON event_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- No UPDATE or DELETE policies: event_logs is append-only.

-- ─── magic_links ────────────────────────────────────────────

CREATE POLICY "magic_links_select_creator" ON magic_links
  FOR SELECT USING (created_by_id = auth.uid());

CREATE POLICY "magic_links_insert_authed" ON magic_links
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Note: magic link confirmation (update) is done server-side via service role,
-- not through RLS. The token-based public access uses the gateway API.

-- ─── exports ────────────────────────────────────────────────

CREATE POLICY "exports_select" ON exports
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "exports_insert" ON exports
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

-- ─── extraction_jobs ───────────────────────────────────────

CREATE POLICY "extraction_jobs_select" ON extraction_jobs
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "extraction_jobs_insert" ON extraction_jobs
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "extraction_jobs_update" ON extraction_jobs
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

-- ─── commitment_terms ──────────────────────────────────────

CREATE POLICY "commitment_terms_select" ON commitment_terms
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "commitment_terms_insert" ON commitment_terms
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "commitment_terms_update" ON commitment_terms
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "commitment_terms_delete" ON commitment_terms
  FOR DELETE USING (public.is_org_writer(public.program_org_id(program_id)));

-- ─── Supabase Storage: private bucket policies ──────────────
-- These must be configured in Supabase Dashboard → Storage → Policies
-- Bucket: "evidence" (private, no public access)
--
-- SELECT: authenticated users who are org members of the file's program
-- INSERT: authenticated users who are org writers
-- DELETE: only via server-side gateway (service role)
--
-- In practice, all storage access goes through signed URLs generated
-- by the Security Gateway API, which verifies org membership before signing.

-- ─── Prevent updates/deletes on event_logs at DB level ──────

CREATE OR REPLACE FUNCTION prevent_event_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event_logs is append-only: updates and deletes are prohibited';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_logs_no_update
  BEFORE UPDATE ON event_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_event_log_mutation();

CREATE TRIGGER event_logs_no_delete
  BEFORE DELETE ON event_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_event_log_mutation();
