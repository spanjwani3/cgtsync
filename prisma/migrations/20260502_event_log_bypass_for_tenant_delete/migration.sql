-- Update the event_logs append-only enforcement to allow a transaction-scoped
-- bypass. By default, all UPDATEs and DELETEs are still rejected so application
-- code can never accidentally mutate or delete audit log rows. The bypass is
-- only honored when `app.bypass_event_log_lock = 'on'` is SET LOCAL within a
-- transaction — which only the platform-admin tenant deletion path does.
--
-- Background: Organization → Program FK is ON DELETE CASCADE; event_logs.
-- program_id FK is ON DELETE SET NULL. When a platform admin deletes a
-- tenant, the cascade tries to set event_logs.program_id = NULL on rows that
-- referenced the deleted programs. Without a bypass, the BEFORE UPDATE
-- trigger raises and aborts the entire transaction, leaving the tenant
-- un-deletable. With the bypass, the platform admin path can complete the
-- delete (and pre-purge the event_logs explicitly so we don't leave orphan
-- audit rows with NULL program_id).

CREATE OR REPLACE FUNCTION prevent_event_log_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.bypass_event_log_lock', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'event_logs is append-only: updates and deletes are prohibited';
END;
$$ LANGUAGE plpgsql;
