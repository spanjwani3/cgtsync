-- ═══════════════════════════════════════════════════════════════════
-- Enable Row Level Security on all core tables
-- Applies org-scoped RLS policies to prevent direct PostgREST access.
-- Prisma connects as postgres superuser and bypasses RLS.
-- ═══════════════════════════════════════════════════════════════════

-- ─── Helper functions ──────────────────────────────────────────

-- Extract user id from Supabase JWT
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$ LANGUAGE sql STABLE;

-- Check if current user is a member of an org
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if current user has a specific role in an org
CREATE OR REPLACE FUNCTION public.has_org_role(p_org_id uuid, p_role "OrgRole") RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org_id AND user_id = auth.uid() AND role = p_role
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if current user is admin or operator in an org
CREATE OR REPLACE FUNCTION public.is_org_writer(p_org_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org_id AND user_id = auth.uid() AND role IN ('ADMIN', 'OPERATOR')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Get org_id for a program
CREATE OR REPLACE FUNCTION public.program_org_id(p_program_id uuid) RETURNS uuid AS $$
  SELECT org_id FROM programs WHERE id = p_program_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─── Enable RLS on core tables ─────────────────────────────────

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

-- Lock down _prisma_migrations (no policies = deny all for non-superuser)
ALTER TABLE _prisma_migrations ENABLE ROW LEVEL SECURITY;

-- ─── users ──────────────────────────────────────────────────────

CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "users_insert_own" ON users
  FOR INSERT WITH CHECK (id = auth.uid());

-- ─── organizations ──────────────────────────────────────────────

CREATE POLICY "orgs_select_member" ON organizations
  FOR SELECT USING (public.is_org_member(id));

CREATE POLICY "orgs_insert_any_authed" ON organizations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "orgs_update_admin" ON organizations
  FOR UPDATE USING (public.has_org_role(id, 'ADMIN'));

-- ─── org_members ────────────────────────────────────────────────

CREATE POLICY "org_members_select_same_org" ON org_members
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_members_insert_admin" ON org_members
  FOR INSERT WITH CHECK (public.has_org_role(org_id, 'ADMIN'));

CREATE POLICY "org_members_update_admin" ON org_members
  FOR UPDATE USING (public.has_org_role(org_id, 'ADMIN'));

CREATE POLICY "org_members_delete_admin" ON org_members
  FOR DELETE USING (public.has_org_role(org_id, 'ADMIN'));

-- ─── programs ───────────────────────────────────────────────────

CREATE POLICY "programs_select_member" ON programs
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "programs_insert_writer" ON programs
  FOR INSERT WITH CHECK (public.is_org_writer(org_id));

CREATE POLICY "programs_update_writer" ON programs
  FOR UPDATE USING (public.is_org_writer(org_id));

-- ─── baselines ──────────────────────────────────────────────────

CREATE POLICY "baselines_select" ON baselines
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "baselines_insert" ON baselines
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "baselines_update" ON baselines
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

-- ─── baseline_clauses ───────────────────────────────────────────

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

-- ─── changes ────────────────────────────────────────────────────

CREATE POLICY "changes_select" ON changes
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "changes_insert" ON changes
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "changes_update" ON changes
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

-- ─── invoices ───────────────────────────────────────────────────

CREATE POLICY "invoices_select" ON invoices
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "invoices_insert" ON invoices
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "invoices_update" ON invoices
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

-- ─── invoice_line_items ─────────────────────────────────────────

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

-- ─── evidences ──────────────────────────────────────────────────

CREATE POLICY "evidences_select" ON evidences
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "evidences_insert" ON evidences
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

CREATE POLICY "evidences_update" ON evidences
  FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

-- ─── event_logs (append-only: select + insert only) ─────────────

CREATE POLICY "event_logs_select" ON event_logs
  FOR SELECT USING (
    program_id IS NULL OR public.is_org_member(public.program_org_id(program_id))
  );

CREATE POLICY "event_logs_insert" ON event_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- No UPDATE or DELETE policies: event_logs is append-only.

-- ─── magic_links ────────────────────────────────────────────────

CREATE POLICY "magic_links_select_creator" ON magic_links
  FOR SELECT USING (created_by_id = auth.uid());

CREATE POLICY "magic_links_insert_authed" ON magic_links
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Magic link confirmation (update) is done server-side via service role,
-- not through RLS. The token-based public access uses the gateway API.

-- ─── exports ────────────────────────────────────────────────────

CREATE POLICY "exports_select" ON exports
  FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));

CREATE POLICY "exports_insert" ON exports
  FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

-- ─── Prevent updates/deletes on event_logs at DB level ──────────

CREATE OR REPLACE FUNCTION prevent_event_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event_logs is append-only: updates and deletes are prohibited';
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'event_logs_no_update'
  ) THEN
    CREATE TRIGGER event_logs_no_update
      BEFORE UPDATE ON event_logs
      FOR EACH ROW EXECUTE FUNCTION prevent_event_log_mutation();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'event_logs_no_delete'
  ) THEN
    CREATE TRIGGER event_logs_no_delete
      BEFORE DELETE ON event_logs
      FOR EACH ROW EXECUTE FUNCTION prevent_event_log_mutation();
  END IF;
END $$;
