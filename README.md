# CGT-Sync v1.0

**Financial & Scope Governance Layer for Biopharma Sponsor-CDMO Programs**

CGT-Sync is not a task or PM tool. It is an audit-ready governance platform that helps biopharma sponsors maintain financial control and scope integrity across CDMO manufacturing programs.

## Core Modules

| Module | Description |
|--------|-------------|
| **Onboarding Wizard** | 3-step program setup: Create Program → Upload Invoice/SOW → Generate first export |
| **Assumption Locker** | Baseline management: Upload SOW/MSA → Extract clauses → Release → Confirm → Lock (immutable) |
| **Change Ledger** | One-Way Valve: Draft → Release → Confirm/Auto-log. Threshold-based auto-logging below configurable amount |
| **Invoice Reconciliation** | Upload → Map line items to baseline/changes → Auto-flag mismatches → Generate Dispute Packets |
| **Cockpit + Red Flags** | Single pane of glass: timeline, metrics, red flags, quick navigation |
| **Export Center** | Baseline Pack, Change Ledger Pack, Invoice Review Pack, Dispute Packet, Weekly Governance Pack |
| **Evidence & Audit** | SHA-256 hashed evidence files, append-only event log, finalization workflow |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | PostgreSQL (via Supabase) |
| ORM | Prisma |
| Auth | Supabase Auth (RBAC: Admin / Operator / Read-only) |
| Storage | Supabase Storage (private buckets, signed URLs) |
| PDF Generation | PDFKit (server-side) |

## Security Posture

- **Multi-tenant by design**: one shared Supabase project, tenant isolation via `org_id` and Row Level Security on every table. Each customer gets their own subdomain (`<slug>.cgtsync.ai`) resolved by middleware to the matching `Organization`.
- **Row Level Security (RLS)** on all tables with org_id + program_id scoping
- **Private storage buckets** with short-TTL signed URLs (5 min)
- **SHA-256 hashing** on all uploaded evidence files
- **Append-only EventLog** with DB-level triggers preventing UPDATE/DELETE
- **Magic Links**: scoped to single object, 24-72h TTL, optional single-use, all views/confirms logged
- **Security Gateway API**: all privileged operations (exports, disputes, evidence finalization, retention) go through Next.js server routes — never directly from the browser
- **Per-program retention settings** with server-side cleanup endpoint

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project (free tier works)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your Supabase credentials:
- `NEXT_PUBLIC_SUPABASE_URL` — Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Anon key
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (for storage operations)
- `DATABASE_URL` — Pooled connection string (port 6543)
- `DIRECT_URL` — Direct connection string (port 5432)

### 3. Set up the database

```bash
# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Or create a migration
npm run db:migrate
```

### 4. Apply RLS policies

Run the SQL in `prisma/sql/rls_policies.sql` in the Supabase SQL Editor.

### 5. Create Supabase storage bucket

In Supabase Dashboard → Storage:
1. Create a bucket named `evidence`
2. Set it to **private** (no public access)

### 6. Seed demo data (optional)

```bash
npx tsx prisma/seed.ts
```

Set `SEED_USER_ID` and `SEED_USER_EMAIL` to match your Supabase auth user.

### 7. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
├── app/
│   ├── (auth)/           Auth pages (login, signup, callback)
│   ├── (dashboard)/      Dashboard layout + pages
│   │   ├── onboarding/   3-step program wizard
│   │   └── programs/
│   │       └── [programId]/
│   │           ├── baseline/   Assumption Locker
│   │           ├── changes/    Change Ledger
│   │           ├── invoices/   Invoice Reconciliation
│   │           ├── cockpit/    Program Cockpit
│   │           ├── evidence/   Evidence & Audit Log
│   │           └── exports/    Export Center
│   ├── api/
│   │   ├── programs/     Program CRUD
│   │   ├── baselines/    Baseline + clause management
│   │   ├── changes/      Change ledger operations
│   │   ├── invoices/     Invoice + line item management
│   │   └── gateway/      Security Gateway (privileged operations)
│   │       ├── evidence/     Upload, view, finalize
│   │       ├── exports/      PDF generation
│   │       ├── magic-link/   Create, validate, confirm
│   │       ├── disputes/     Dispute packet generation
│   │       └── retention/    Retention cleanup
│   └── confirm/[token]/  Magic link confirmation page
├── components/
│   ├── layout/           Sidebar navigation
│   └── ui/               StatusBadge and shared components
├── lib/
│   ├── prisma.ts         Prisma client singleton
│   ├── server/           Server-only utilities
│   │   ├── auth.ts       RBAC auth helpers
│   │   ├── event-log.ts  Append-only event logging
│   │   ├── magic-link.ts Magic link management
│   │   ├── pdf.ts        PDF generation
│   │   └── storage.ts    Supabase storage + SHA-256
│   └── supabase/         Supabase client helpers
└── middleware.ts          Subdomain → tenant resolution + session refresh
```

## RBAC Roles

| Role | Capabilities |
|------|-------------|
| **Admin** | Full access + retention cleanup + user management |
| **Operator** | Create/edit programs, baselines, changes, invoices, evidence, exports |
| **Read-only** | View all data, no modifications |

## Key Concepts

### Baseline Lifecycle
`DRAFT → RELEASED → CONFIRMED → LOCKED → SUPERSEDED`

Once LOCKED, a baseline is immutable. Amendments create a new baseline version that supersedes the previous.

### Change One-Way Valve
`DRAFT → RELEASED → CONFIRMED/AUTO-LOGGED`

If a change's estimated impact is below the program's `changeThreshold`, it automatically transitions to LOGGED status on release, skipping explicit confirmation.

### Invoice Reconciliation Auto-Flags
- **RATE_MISMATCH**: Line item amount differs from baseline clause value by >5%
- **MISSING_BASELINE**: No baseline clause or change order mapped
- **SCOPE_CREEP**: Manual flag for out-of-scope work
- **UNAPPROVED_CHANGE**: Charge mapped to unconfirmed change
- **DUPLICATE**: Potential duplicate line item

### Inbound-Email Candidate Reconciliation

Each program may have an `inboundEmailAddress` (e.g., `cellipont@inbox.cgtsync.ai`).
Forwarded meeting notes / cc'd email correspondence land at the Postmark Inbound
webhook (`/api/gateway/inbound-email`), are stored as Evidence with
SPF/DKIM provenance, and any extracted candidate changes are immediately
reconciled against the locked baseline + confirmed changes:

- **IN_BASELINE** — discussion of in-scope work; not creep
- **ALREADY_CONFIRMED** — already covered by a confirmed change order
- **SCOPE_CREEP_CANDIDATE** — net-new scope for PM review
- **NEEDS_VERIFICATION** — sender failed SPF/DKIM or isn't on the program's `inboundSenderAllowlist`

## Tenant Onboarding (multi-tenant prod)

```bash
# 1. Create org, program, admin users (mints magic links to stdout):
npx tsx scripts/onboard-tenant.ts \
  --slug cellipont \
  --name "Cellipont" \
  --program "Cellipont — CDMO Manufacturing" \
  --cdmo "Cellipont" \
  --admin jkuzniar@cellipont.com,dkommireddy@cellipont.com,ebeale@cellipont.com \
  --inbound cellipont@inbox.cgtsync.ai \
  --allow-domain cellipont.com

# 2. Drop their PDFs in scripts/tenant-seed-docs/<slug>/, then:
npx tsx scripts/preload-tenant-docs.ts \
  --slug cellipont \
  --program "Cellipont — CDMO Manufacturing" \
  --dir scripts/tenant-seed-docs/cellipont \
  --actor <samir-supabase-user-id>
```

DNS for the platform: wildcard `CNAME *.cgtsync.ai → cname.vercel-dns.com`,
`MX inbox.cgtsync.ai 10 inbound.postmarkapp.com`, plus an SPF TXT for `inbox`.

Set `MULTI_TENANT_MODE=true` and `ROOT_DOMAIN=cgtsync.ai` in production env.
Disable public signups in Supabase Auth → Providers → Email.

For local dev with subdomains use `<slug>.localhost:3000` (modern browsers
resolve this automatically).

## Scripts

```bash
npm run dev          # Development server
npm run build        # Production build
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Create and apply migration
npm run db:push      # Push schema without migration
npm run db:studio    # Open Prisma Studio
```
