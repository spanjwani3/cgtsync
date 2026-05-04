# CGT Sync — Operations Runbook

This runbook covers backup, restore, and migration safety for CGT Sync running on Supabase. It's the document you reach for when something has gone wrong (or to prevent it from going wrong in the first place).

If you're new to the project, start with `README.md` and `docs/architecture.md` — this document assumes you can already run the app locally.

---

## 1. Backup reality on Supabase Free tier

Production is on **Supabase Free tier**. Be honest about what that gives us:

| What | Free tier reality |
|---|---|
| Daily database snapshots | Yes, kept for 7 days |
| Self-serve restore | **No.** Restoring requires a Supabase support ticket |
| Point-in-time recovery (PITR) | No. Recovery granularity is 24h |
| Storage bucket backups | Inconsistent. Don't assume Evidence files are in the snapshot |
| Auth user backups | Supabase Auth has its own backup behavior, separate from the public schema |

**What this means in practice:**
- **RPO (data loss tolerance)**: Up to 24h of writes can be lost if we rely on Supabase's snapshot alone. Tighter only if we run `npm run db:backup` more frequently.
- **RTO (recovery time)**: Hours to days. Depends entirely on Supabase support ticket response time.
- **The 7-day cliff**: Any issue discovered more than 7 days after it occurred is unrecoverable from Supabase alone.
- **Evidence (PDFs, transcripts)**: If the storage bucket is lost, the audit chain breaks — even if we have the database.

This runbook **does not paper over those limitations**. It documents them and gives us a self-serve escape hatch (Section 2) so we are not entirely at Supabase support's mercy.

---

## 2. Self-serve database backups

We run our own `pg_dump` on demand. This produces a single compressed SQL file we own and can replay anywhere.

### Prerequisites
- `pg_dump` installed (PostgreSQL 16 client tools — `apt install postgresql-client-16` on Ubuntu, `brew install libpq && brew link --force libpq` on macOS).
- `.env` populated with `DIRECT_URL` (the port-5432 direct connection, not the pooler on 6543).

### Run a backup
```bash
npm run db:backup
```

Output:
- File: `./backups/cgtsync-YYYYMMDDHHMMSS.sql.gz`
- Logged: file path, file size, restore command.

The `backups/` directory is gitignored. Backups stay on the developer's machine unless they explicitly move them.

### Recommended cadence
- **Always before risky operations.** Run before any of: schema migrations, bulk imports, retention deletes, scripts that touch >100 rows, manual SQL applied via Supabase SQL Editor.
- **Weekly minimum.** Set a calendar reminder. While we're on Free tier this is the only way to extend our retention beyond Supabase's 7-day window.

### Rotation
- Keep the **last 4 weekly** snapshots and **every pre-migration snapshot for 30 days**.
- Older dumps can be deleted manually. Check with `du -sh backups/*` and `rm` what you no longer need.
- If you want geographic redundancy, copy dumps to an external drive, S3 bucket, or another machine. The script does not do this for you.

### What's in the dump
- All tables in the `public` schema, with data.
- DDL with `DROP IF EXISTS` clauses (safe to replay against a non-empty DB).
- **Not included**: Supabase Auth users, RLS policies (those live in `prisma/sql/rls_policies.sql`), Storage bucket contents, Edge Functions.

---

## 3. Restore procedures by scenario

### Scenario A — Bad migration just shipped (within minutes)

When you discover a migration broke something live, restoring from a dump is usually slower than fixing forward.

1. **First**, check whether the migration is reversible by hand. Most additive migrations (new column, new table) can be reversed with a one-line `DROP COLUMN` / `DROP TABLE`.
2. Apply the inverse SQL via the **Supabase SQL Editor** (Tier 1 pattern).
3. Run `npx prisma migrate resolve --rolled-back <migration_name>` to update Prisma's tracking. Note: this only updates Prisma's `_prisma_migrations` table — it does not execute any rollback SQL.
4. Edit or remove the offending migration directory in `prisma/migrations/`, commit the fix, redeploy.

Use a dump-based restore (Scenario C) only if hand-reversal is not feasible.

### Scenario B — Data corruption / accidental delete (recent, < 24h)

1. **Stop the bleeding**: identify and disable whatever caused the corruption (pause a script, revoke a token, lock down a route). Then take a fresh `npm run db:backup` of the *current* (corrupted) state — you may need it for forensics.
2. **If a recent pre-event dump exists** (e.g. taken before a risky import): restore it into a fresh Supabase project per Scenario C, validate the data, then either repoint env vars or selectively `INSERT … ON CONFLICT` the recovered rows back into prod.
3. **If no pre-event dump exists**: open a Supabase support ticket asking for a restore from their daily snapshot. Be specific about timestamp. Expect a multi-hour response.

### Scenario C — Catastrophic loss (whole project gone or unrecoverable)

End-to-end recovery from a `pg_dump` file. Allow ~1 hour, more if Evidence files need re-uploading.

1. **Provision a new Supabase project.** Same region as the original. Note the new project ref, anon key, service role key, DIRECT_URL, DATABASE_URL.
2. **Apply the schema:**
   ```bash
   DIRECT_URL="postgresql://postgres.<new-ref>:<pw>@db.<new-ref>.supabase.co:5432/postgres" \
     npx prisma migrate deploy
   ```
3. **Apply RLS policies** by pasting `prisma/sql/rls_policies.sql` into the new project's Supabase SQL Editor and running it.
4. **Restore data from the latest dump:**
   ```bash
   gunzip -c backups/cgtsync-YYYYMMDDHHMMSS.sql.gz | psql "$DIRECT_URL"
   ```
   (The dump uses `DROP IF EXISTS` and `--no-owner --no-acl`, so it will overlay cleanly on the freshly-migrated schema.)
5. **Re-create the Evidence storage bucket** in the new project (named per `SUPABASE_EVIDENCE_BUCKET`, default `evidence`). Make it private. If you have an off-Supabase copy of the Evidence files, re-upload them with their original storage paths intact (the DB rows reference those paths). Without those files, Evidence rows will dangle.
6. **Update env vars** on Vercel (production) and any staging environments to point at the new Supabase project: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL`.
7. **Regenerate the table map:**
   ```bash
   npx tsx scripts/generate-table-map.ts
   ```
8. **Sanity-check**:
   - `SELECT count(*) FROM organizations;` — matches expectation.
   - `SELECT count(*) FROM programs;` — matches.
   - `SELECT count(*) FROM invoices;` — matches.
   - Latest invoice `id`/`createdAt` matches the moment of the dump.
   - Hit `/api/admin/health` and confirm `multi_tenant_mode`, `root_domain`, project ref consistency.
   - Log in as an org admin and verify the cockpit loads.
9. **Notify customers** if their data lost any time window. Be specific about what they may need to re-do.

### Scenario D — Single-tenant rollback (one org wants their data reverted)

**Out of scope on Free tier.** We do not have per-tenant export/snapshot capability today. If a single tenant needs a data rollback while others continue, the only options are:
- Manual SQL surgery against EventLog history (labor-intensive, fragile).
- Restore the entire DB to a side project, export just that tenant's rows, re-insert into prod.

If this scenario becomes routine, add per-tenant export tooling as a separate workstream.

---

## 4. Restore drill (quarterly)

A backup you've never restored is wishful thinking. Once a quarter, run a restore drill manually. Track each drill in the **Drill log** below.

### Procedure
1. Take a fresh `npm run db:backup`.
2. Provision a free Supabase project named `cgtsync-restore-drill-YYYYQq` (e.g. `cgtsync-restore-drill-2026q2`).
3. Capture its DIRECT_URL into a temporary env var: `export RESTORE_DIRECT_URL="postgresql://..."`.
4. Apply schema: `DIRECT_URL="$RESTORE_DIRECT_URL" npx prisma migrate deploy`.
5. Apply RLS policies via the drill project's SQL Editor.
6. Restore data: `gunzip -c backups/<latest>.sql.gz | psql "$RESTORE_DIRECT_URL"`.
7. Run sanity queries. Compare row counts of `organizations`, `programs`, `invoices`, `event_logs`, `evidence` against prod.
8. Record outcome in the Drill log.
9. Tear down the drill project (Supabase dashboard → project settings → delete).

### Drill log

| Date | Performed by | Outcome | Notes |
|---|---|---|---|
| _next drill due:_ | | | |

(Add a row each time. Include any surprises — they're the entire point of drilling.)

---

## 5. When to upgrade Supabase tier

The Free-tier backup story has a known gap. Upgrade to **Pro ($25/mo) + PITR add-on (~$100/mo)** when **any** of these become true:

- First paying customer with non-trivial data is onboarded.
- Total customer-trackable financial data in the system exceeds ~$50K.
- Any customer with a contractual SLA or compliance requirement (SOC 2, HIPAA, etc.) signs.
- Cellipont (or any anchor customer) signs a paid contract.
- A near-miss data incident occurs on Free tier — that's the warning, take the upgrade.

What the upgrade buys:
- **PITR** — recovery to any point in the last 7 days, second-level granularity.
- **Self-serve restore** via the Supabase dashboard (no support ticket).
- **Daily backups** retained for 7 days (same as Free, but accessible).
- **Storage bucket backup behavior is more reliable** on paid tiers — verify in Supabase docs at upgrade time.

After upgrading, revisit Sections 1, 2, and 3 of this runbook and tighten the RPO/RTO claims accordingly.

---

## 6. Pre-migration checklist

Copy this checklist into the description of every PR that contains a database migration. If any box can't be ticked, hold the PR.

```
- [ ] Migration is additive only, OR destructive change is intentional and documented.
- [ ] `npm run db:backup` ran cleanly within the last hour. Dump file path:
- [ ] Backup file size sanity-checked (not zero, not 100x the usual size).
- [ ] Migration SQL applied in Supabase SQL Editor first (Tier 1 pattern).
- [ ] Schema verified in Supabase Table Editor (new columns/tables visible).
- [ ] Code merged only after migration is confirmed live in the DB.
- [ ] Post-deploy sanity check: ran a known query, got the expected result.
- [ ] If the migration changes RLS, `prisma/sql/rls_policies.sql` was updated and re-applied.
```

### Tier 1 migration pattern (refresher)

CGT Sync applies migrations to production via the Supabase SQL Editor *before* merging the corresponding code. This avoids the failure mode where Vercel deploys schema-dependent code against an unmigrated database.

The order is:
1. Write the migration locally and verify against a fresh DB (`npm run db:migrate`).
2. Open a PR. Reviewer checks the SQL for correctness.
3. Take a backup: `npm run db:backup`.
4. Apply the migration SQL in Supabase SQL Editor (production project).
5. Merge the PR. Vercel deploys; code now matches the live schema.
6. If anything goes wrong between steps 4 and 5, revert the SQL (or restore from the backup taken in step 3) before merging.

---

## Appendix — Useful queries during recovery

```sql
-- Row counts per top-level tenant table
SELECT 'organizations' AS t, count(*) FROM organizations
UNION ALL SELECT 'programs', count(*) FROM programs
UNION ALL SELECT 'baselines', count(*) FROM baselines
UNION ALL SELECT 'invoices', count(*) FROM invoices
UNION ALL SELECT 'changes', count(*) FROM changes
UNION ALL SELECT 'evidence', count(*) FROM evidence
UNION ALL SELECT 'event_logs', count(*) FROM event_logs;

-- Latest activity (does the data look fresh enough?)
SELECT 'latest_invoice' AS t, max("createdAt") FROM invoices
UNION ALL SELECT 'latest_change', max("createdAt") FROM changes
UNION ALL SELECT 'latest_event_log', max("createdAt") FROM event_logs;

-- Dangling evidence (storage path references that may no longer resolve)
SELECT count(*) FROM evidence WHERE "storagePath" IS NOT NULL;

-- RLS sanity check
SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false;
```
