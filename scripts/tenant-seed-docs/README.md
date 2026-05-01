# Tenant seed docs

Drop a customer's contract PDFs into a subdirectory named after their tenant slug, then run:

```bash
npx tsx scripts/preload-tenant-docs.ts \
  --slug <tenant-slug> \
  --program "<program name>" \
  --dir scripts/tenant-seed-docs/<tenant-slug> \
  --actor <samir-supabase-user-id>
```

Filename conventions for evidence-type inference:

- `base-contract*.pdf`, `msa*.pdf`, `sow*.pdf` → `SOW_MSA` → BASELINE extraction
- `co-*.pdf`, `change-order-*.pdf`, `amendment-*.pdf` → `CHANGE_ORDER` → CHANGE_ORDER extraction

Files in this directory are gitignored. They never get committed.
