# Cellipont Production Pilot — Setup Plan (revised)

## Tier 1 increment status — ✅ all shipped 2026-05-03

| # | Item | Status | PR |
|---|---|---|---|
| 1 | `/admin/*` on dedicated `admin.cgtsync.ai` subdomain | ✅ shipped | #12 |
| 2 | Auto-email onboarding magic links + temp passwords (Resend) | ✅ shipped | #13 |
| 2a | Magic-link `/login` fragment handler (implicit-flow tokens) | ✅ shipped | #15 |
| 2b | Tenant lifecycle: Vercel auto-add domain, hard-delete tenant, reset program | ✅ shipped | #14 |
| 2c | Surface Prisma error details on `/api/admin/tenants` (diagnostic) | ✅ shipped | #16 |
| 2d | Allow tenant DELETE to mutate event_logs via session-local bypass | ✅ shipped | #17 |
| 3 | Self-service forgot-password flow | ✅ shipped | #18 |
| 4 | Program soft-delete with grace period | ⏳ deferred (hard delete + reset shipped in #14; soft-delete is polish, not eval-blocking) |
| 5 | Re-enable `MULTI_TENANT_MODE` (wire `requireTenantOrgAccess` everywhere) | ✅ shipped + flag flipped to true in production | #19 |

---

## 2026-05-03 — Tier 2 + 3 roadmap (NEW SESSION HANDOFF)

**Read this section first if you're picking up a fresh session.** The Tier 1 work above is shipped; what follows is the roadmap for everything the user wants next, in recommended order. Each item has its own self-contained subsection with context, files, design decisions, and verification.

### User priorities (verbatim from the conversation that closed Tier 1)

1. **Rebrand "CGT-Sync" → "CGT Sync"** (no hyphen) everywhere + visual refresh to match the marketing website (clean white/light bg, navy text, bright blue accents, serif italics for emphasis, shield-with-checkmark logo). Add **branded loading states** where they make sense.
2. **Per-tenant branding** (logo + accent color in sidebar, applied to email CTAs and PDFs).
3. **World-class onboarding tour** — first-time user experience, dismissable, completion-tracked. "Don't skimp."
4. **Tenant-level audit log UI** — org admins see "every change to this baseline" + a **ROI / value-delivered widget on the executive dashboard** (revenue collected, change orders caught via scope detection, scope creep paid for).
5. **Production monitoring/alerting** + a **customer-value dashboard for platform admin** (what's CGT Sync caught for each tenant: $$ saved, scope creep, etc.).
6. **Backup/restore plan for Supabase.**
7. **Multi-org user model for support staff** (so Samir doesn't have to log in as Jennifer to debug).

### Recommended order

**Phase A — Pre-eval polish (eval-impacting, Cellipont sees these):**

| # | Item | Est. | Eval impact |
|---|---|---|---|
| A1 | Rebrand + visual refresh + branded loading states | ½ day | High — first impression for Cellipont users |
| A2 | Per-tenant branding (logo + accent color) | ½ day | High — Cellipont sees their colors instead of generic CGT Sync |
| A3 | Onboarding tour | 1 day | High — Jennifer doesn't get stuck on first login |
| A4 | Tenant audit log UI + ROI dashboard widget | 1 day | High — Dinesh sees the value, supports the buying decision |

**Phase B — Operational (post-eval, internal):**

| # | Item | Est. | Why deferred |
|---|---|---|---|
| B1 | Supabase backup/restore runbook | ½ day | Mostly docs + Supabase config — quick to slot in anywhere |
| B2 | Production monitoring + customer-value tracking | 1 day | Needed once a customer is live; can ship after eval |
| B3 | Multi-org user model for support staff | 1 day | Nice-to-have for support workflow; not customer-visible |

**Total: ~5 days of work.** Phase A is ~3 days; Phase B is ~2.5 days.

**Order rationale:** A1 first because every later UI change builds on the new visual foundation — don't rebuild components twice. A2 depends on A1's CSS variables. A3 and A4 are independent of each other and could parallel A2 if multiple agents work concurrently. Phase B is post-eval; B1 (docs/config) and B2 (instrumentation) can run in parallel; B3 (auth/schema change) goes last because it touches the auth surface and we want the eval to stabilize first.

---

## Phase A1 — Rebrand + visual refresh + branded loading states

### Context

- **35+ instances of "CGT-Sync"** across 24 files (audit-confirmed). No existing uses of "CGT Sync" without the hyphen — clean migration.
- Marketing site uses light bg, navy text (`#1a2332`), bright blue (`#2563eb`) for accents, serif italics for emphasis (e.g. "Invoices get disputed months later"), shield-with-checkmark logo on dark navy bg.
- Product currently uses **teal accents** (`#0d9488` in CSS vars, `text-teal-400` in 31 places) and an **inline shield SVG** rendered via `<svg>` with `text-teal-*` classes — the path is duplicated across login/forgot-password/reset-password/sidebar/confirm pages. Email templates already use NAVY/ACCENT — they're partially aligned.
- The auth pages have a **dark navy bg** (`bg-[#1a1f2e]`) which matches the marketing site logo backdrop — keep dark for auth, but swap teal → blue accents.
- Domain `cgtsync.ai` and localStorage keys `cgtsync_*` and the npm package name `cgtsync` should NOT change — those are infrastructure identifiers, not brand display.

### Scope

**1. Text rebrand** — every visible "CGT-Sync" → "CGT Sync". Files (35+ hits across):
- `src/app/layout.tsx:5` (root metadata title)
- `src/app/page.tsx:14` (homepage hero)
- `src/app/(auth)/{login,signup,forgot-password,reset-password}/page.tsx`
- `src/app/confirm/[token]/page.tsx` (multiple)
- `src/components/layout/Sidebar.tsx:213`
- `src/lib/server/email-templates.ts` (header + 8 template footers + welcome/reset bodies)
- `src/lib/server/{pdf,dispute-pdf}.ts` (PDF metadata + headers/footers)
- `src/app/api/gateway/certificate/route.ts` (footers)
- `src/lib/server/onboard-tenant.ts:333` (welcome subject)
- `src/app/api/auth/forgot-password/route.ts:122` (reset subject)
- `README.md`, `prisma/seed.ts` (less critical, but include for thoroughness)

**2. Color system** — replace teal with bright blue everywhere:
- `src/app/globals.css` CSS vars: `--sidebar-active: #0d9488` → `#2563eb`. Add a sibling `--sidebar-active-hover: #1d4ed8`.
- All `text-teal-*` and `bg-teal-*` Tailwind classes → blue-equivalents (or, better, switch to a CSS-var-driven `text-accent` class so per-tenant accent in A2 just works). 31 hits across `src/app/(auth)/`, `src/components/ui/ExtractionProgress.tsx`, change-impact card, confirm-page badge.
- Auth pages keep their dark navy bg — visual contrast with marketing site is intentional (auth is "platform", marketing is "we sell to you").

**3. Logo** — replace the inline path-based shield with the actual marketing-site logo (shield with blue checkmark on dark navy). Two options:
- **Option A**: SVG component `src/components/brand/Logo.tsx` with size + variant props (`light`/`dark`). Reused everywhere. Recommend.
- **Option B**: PNG/SVG static asset under `public/logo.svg` referenced via `<img>`. Simpler but less flexible (no recoloring for tenant branding).

Recommend Option A — keeps tenant accent recoloring possible (A2 swaps the checkmark fill via CSS var).

**4. Branded loading states** — current loading patterns are generic Tailwind spinners. Upgrade to:
- **Page-level loaders** (`src/app/(dashboard)/loading.tsx` and similar): brand logo with subtle pulse animation, centered.
- **Inline button loaders** (login/forgot-password/reset-password submit buttons): keep small spinner but recolor to brand accent.
- **Skeleton loaders** for major data lists (programs list, baseline view, invoice table). Light-gray pulsing rectangles matching the final layout. Place under `src/components/ui/Skeleton.tsx` (new).
- **Brand "splash" loader** for slow operations (extraction job progress, PDF generation): logo + progress bar. Replaces the current `ExtractionProgress.tsx` styling.

**5. Typography refresh** — marketing site uses serif italics for emphasis ("Invoices get disputed *months later*"). Optional: introduce a serif font (e.g. Noto Serif or Source Serif Pro via `next/font`) and use it for `<em>` and h1/h2 emphasis classes. Not strictly needed; defer if scope is tight.

### Critical files

- **NEW** `src/components/brand/Logo.tsx` — single source of truth for the shield logo
- **NEW** `src/components/ui/Skeleton.tsx` — skeleton loaders
- `src/app/globals.css` — CSS var swaps (teal → blue)
- `src/app/layout.tsx` — metadata title
- `src/lib/server/email-templates.ts` — replace text "CGT-Sync" header in `baseLayout` with proper logo image (data URI or hosted), update all 8 template subjects + footers
- `src/lib/server/{pdf,dispute-pdf}.ts` — PDF metadata + header/footer
- `src/app/api/gateway/certificate/route.ts` — certificate footer
- `src/components/layout/Sidebar.tsx:211-213` — swap inline shield SVG for `<Logo />`
- `src/app/(auth)/{login,signup,forgot-password,reset-password}/page.tsx` — swap inline shield SVG for `<Logo />`, recolor teal → blue
- `src/app/confirm/[token]/page.tsx` — branding text + logo
- `src/components/ui/ExtractionProgress.tsx` — recolor teal → blue
- `src/app/(dashboard)/loading.tsx` — branded loading state

### Design decisions

- **Don't change domain `cgtsync.ai`** — it's the actual hostname; user's DNS + Vercel domains all use it. Just change display name.
- **Don't change localStorage keys** (`cgtsync_my_programs`, `cgtsync_onboarding_programId`) — purely internal; renaming would invalidate active sessions.
- **Don't change npm package name** in `package.json` — infrastructure identifier.
- **Bulk-rename via `sed`** is risky (could touch comments, JSON, test data). Do file-by-file edits with `Edit` tool to be safe; the Explore agent already enumerated all hits.

### Verification

- [ ] No `grep -rn "CGT-Sync" src/` matches after the rebrand (excluding deliberate exceptions like NPM package or domain references)
- [ ] Browser: every page (`/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/confirm/<token>`, `/programs`, sidebar, all dashboard pages) renders new logo + new color
- [ ] Email: send a confirmation email to a test inbox; verify subject says "CGT Sync" (no hyphen), header has new logo, CTA button is bright blue, footer says "CGT Sync"
- [ ] PDF: download a dispute pack; verify metadata shows "CGT Sync" as Author, footer says "CGT Sync | Confidential"
- [ ] Skeletons: throttle network to "Slow 3G" in DevTools, navigate to `/programs` → see branded skeletons during fetch, not white space + spinner
- [ ] Browser tab title shows "CGT Sync" not "CGT-Sync"

---

## Phase A2 — Per-tenant branding (logo + accent color)

### Context

- Schema already has `Organization.logoUrl String?` (used by `/api/org/logo` POST/GET).
- Schema does NOT have `Organization.accentColor` — needs migration.
- Sidebar takes only `orgName` prop; doesn't render a logo image.
- Email templates and PDFs use hardcoded `ACCENT = "#2563eb"`.
- A1 establishes CSS-variable-driven accent colors. A2 extends that to per-tenant overrides.

### Scope

**1. Schema migration** (additive):

```sql
ALTER TABLE "organizations" ADD COLUMN "accent_color" TEXT;
ALTER TABLE "organizations" ADD COLUMN "brand_name" TEXT;
```

(`brandName` lets a tenant override "CGT Sync" with their own product name in their own portal — optional. Skip if scope is tight.)

Apply via Supabase SQL editor before merging the code (same pattern as previous Tier 1 enum migrations).

**2. Settings UI** — add to `/programs/[programId]/settings/page.tsx` or a new `/settings/branding/page.tsx`:
- Upload logo (existing `/api/org/logo` POST works)
- Color picker for accent (constrain to a palette: brand defaults + tenant-chosen hex). Use `react-colorful` or just a `<input type="color">`.
- Validate accent is high-contrast against white bg (warn if too light, e.g. yellow on white)
- Save calls a new `PATCH /api/org/branding` endpoint

**3. Sidebar rendering** — extend `SidebarProps` with `logoUrl?: string` and `accentColor?: string`:
- If `logoUrl` set: render `<img>` at the top instead of `<Logo />`. Cap dimensions (e.g. 32px height).
- If `accentColor` set: emit a `<style>` block with `--sidebar-active: ${accentColor}` scoped to a wrapper. Tailwind classes that use `text-accent` / `bg-accent` automatically pick it up.

**4. Email + PDF tenant accent** — when `sendEmail` is called from `email.ts`, look up the orgId's accentColor and thread through to `renderXxxEmail` params. Default to brand `#2563eb` if not set.

**5. Default fallback** — if a tenant hasn't set logo/accent, render the CGT Sync brand. Don't force tenants to configure.

### Critical files

- `prisma/schema.prisma` + new migration `20260504_org_branding/migration.sql`
- **NEW** `src/app/api/org/branding/route.ts` — PATCH for accentColor + brandName
- **NEW** `src/app/(dashboard)/settings/branding/page.tsx` + client form component
- `src/components/layout/Sidebar.tsx` + `SidebarWithContext.tsx` — accept logo/accent props
- `src/app/(dashboard)/layout.tsx` — fetch tenant branding fields and pass to sidebar
- `src/lib/server/email.ts` — load branding from org and thread to template renderers
- `src/lib/server/email-templates.ts` — accept optional `accentColor` param; default to `#2563eb`
- `src/lib/server/{pdf,dispute-pdf}.ts` — same

### Verification

- [ ] As Cellipont admin: upload a logo + pick a brand-blue accent → reload `/programs` → see Cellipont's logo in sidebar + their blue on active nav items
- [ ] As Cellipont admin: trigger a baseline confirmation email → recipient sees Cellipont's logo + accent in the CTA
- [ ] Generate a dispute pack PDF → header has Cellipont's accent
- [ ] Other tenant unaffected (still sees CGT Sync defaults)
- [ ] Validation: try an unreadable accent (e.g. `#ffff99`) → settings UI warns

---

## Phase A3 — Onboarding tour (world-class)

### Context

- No tour library installed today.
- No first-login detection in `src/app/(dashboard)/layout.tsx`.
- `User` model has no metadata field for tour state.
- `/programs` empty state has a "Create Program" button but no guidance about what to do next once a program exists.

### Scope

**1. Tour library** — install `react-joyride` (most flexible, well-maintained, MIT license, 13k+ stars). Alternative: `driver.js` (lighter but less React-idiomatic). Recommend react-joyride.

```
npm install react-joyride
```

**2. Tour state storage** — add to schema:

```prisma
model User {
  // ...existing fields
  onboardingState Json @default("{}") @map("onboarding_state")
}
```

Migration: `ALTER TABLE "users" ADD COLUMN "onboarding_state" JSONB DEFAULT '{}'::jsonb NOT NULL;`

`onboardingState` JSON shape:
```json
{
  "tour_v1_started_at": "2026-05-03T...",
  "tour_v1_completed_at": null,
  "tour_v1_dismissed_at": null,
  "tour_v1_step": 3
}
```

**3. Tour content** — multi-step, world-class. Each step has: target selector, title, body, position, optional CTA. Use a steps array in `src/lib/onboarding/tourSteps.ts`:

1. **Welcome** (no anchor, modal-style center) — "Welcome to CGT Sync. Let's set up your first program in 3 minutes." Skip / Start tour.
2. **Sidebar overview** (anchor: sidebar) — "This is your control panel. Programs, baselines, changes, invoices — all here."
3. **Create program** (anchor: "+ New Program" button) — "Start by creating your first program. A program is one CDMO agreement."
4. **Upload SOW** (anchor: SOW upload area on program detail) — "Drop your SOW here. We'll extract baseline scope, deliverables, and commercial terms automatically."
5. **Lock baseline** (anchor: baseline status pill) — "Once you've reviewed the extracted clauses, lock the baseline. This is your commercial truth."
6. **When changes happen** (anchor: changes nav item) — "When the CDMO emails you a scope change or you discuss one on a call, log it here. We'll match it to your baseline + estimate cost impact."
7. **Reconcile invoices** (anchor: invoices nav item) — "Upload incoming invoices. We'll line-match them to your baseline + changes and flag anything that doesn't match."
8. **Audit trail + ROI** (anchor: dashboard nav item) — "See every change, every dispute prevented, and total $$ protected. The CFO will love it."
9. **Done** (modal-style center) — "That's the loop: SOW → baseline → changes → invoices. Need a refresher? Click 'Restart tour' in the sidebar." [Got it]

**4. Trigger logic** — in dashboard layout (server component), check `user.onboardingState.tour_v1_completed_at` and `tour_v1_dismissed_at`. If both null, mount the tour client-side. Provide:
- "Skip tour" button on every step → sets `tour_v1_dismissed_at`
- "Remind me later" button on welcome step only → sets a `tour_v1_remind_at` timestamp; tour re-fires on next session after that timestamp
- Auto-start on first `/programs` load
- Restartable from sidebar "Help → Restart tour"

**5. Persistence** — tour state changes call `POST /api/onboarding/state` which updates `User.onboardingState`. Debounce step changes (don't write on every step, just on milestones).

**6. Accessibility** — react-joyride supports ARIA, keyboard nav, focus trapping. Verify with screen reader.

### Critical files

- `prisma/schema.prisma` + new migration `20260505_user_onboarding_state/migration.sql`
- `package.json` — add `react-joyride`
- **NEW** `src/lib/onboarding/tourSteps.ts` — step definitions
- **NEW** `src/components/onboarding/Tour.tsx` — client component wrapping `<Joyride />`
- **NEW** `src/app/api/onboarding/state/route.ts` — POST endpoint to update tour state
- **NEW** `src/app/(dashboard)/onboarding/restart/route.ts` — clears tour state to re-trigger
- `src/app/(dashboard)/layout.tsx` — server-side fetch of onboarding state, pass to client tour wrapper
- `src/components/layout/Sidebar.tsx` — add "Help" menu with "Restart tour" link

### Design decisions

- **Tour version pinned in field name** (`tour_v1_*`). When we add a v2 tour later, users see v2 from scratch.
- **Don't auto-restart** if user explicitly dismissed; only auto-restart on "Remind me later".
- **Anchors via `data-tour` attributes** on target elements rather than CSS class selectors — survives refactors.
- **Mobile**: tour uses tooltip placement that adapts; if mobile is too cramped, fall back to modal-style center steps. Cellipont eval is desktop, so prioritize that.

### Verification

- [ ] Sign up a fresh user → land on `/programs` → tour starts automatically with welcome modal
- [ ] Click through all 9 steps → final step's "Got it" closes tour → `User.onboardingState.tour_v1_completed_at` is set
- [ ] Sign out + sign in → tour does NOT re-fire
- [ ] Sidebar → Help → Restart tour → tour re-fires from step 1
- [ ] Click "Skip" mid-tour → sets `tour_v1_dismissed_at`; tour doesn't re-fire even if you log out + back in
- [ ] Click "Remind me later" on welcome → tour closes; verify it re-fires on next session
- [ ] Each tour anchor (data-tour=...) actually exists on the DOM at the right time (e.g. "Lock baseline" anchor only valid when on a program with a baseline draft)
- [ ] Keyboard: Tab through tour, Esc closes, Enter advances

---

## Phase A4 — Tenant audit log UI + ROI dashboard widget

### Context

- `EventLog` model captures every tenant-side action (`USER_LOGIN`, `BASELINE_CREATED`, `BASELINE_LOCKED`, `CHANGE_RELEASED`, `CHANGE_CONFIRMED`, `INVOICE_FLAGGED`, `EVIDENCE_UPLOADED`, `SCOPE_ALERT_CREATED`, `EMAIL_SENT`, etc.)
- Platform admin has `/admin/activity` (PR #10) — cross-tenant view.
- No tenant-level audit endpoint today — Cellipont's CFO can't say "show me every change to Baseline v3".
- `Change.estimatedImpact Decimal?` and `ScopeAlert.estimatedImpact Decimal?` exist — can be summed for ROI.
- `Invoice.totalAmount` exists; flagged/disputed are status enums.

### Scope

**Two distinct deliverables:**

#### 1. Tenant audit log UI

- **NEW** `GET /api/audit/route.ts` — uses `requireTenantOrgAccess()`, returns paginated EventLog rows where `programId IN (orgs programs)`. Filters: `action` (enum), `userId`, `entityType`, `dateFrom`, `dateTo`, `programId`. Joins User for the actor name and Program for the program name.
- **NEW** `/programs/[programId]/audit/page.tsx` — table with action / actor / entity / timestamp + clickable links into the affected entity. Filter sidebar.
- **OR**: extend the existing `AuditDrawer` (already in `src/components/layout/AuditDrawer.tsx`) to fetch from this endpoint. The drawer pattern is already wired into the dashboard layout — easier ship than a new page.

Recommend: extend the drawer for v1. New page in v2 if Cellipont wants a dedicated view.

#### 2. ROI / value-delivered widget on executive dashboard

Metrics to add (`/api/dashboard/executive/route.ts` extension):

- **Scope creep caught (cumulative $$):** `SUM(Change.estimatedImpact)` for changes where `status IN ('CONFIRMED','RELEASED')` — these are scope changes the customer caught and got documented.
- **Scope alerts converted to changes:** `SUM(ScopeAlert.estimatedImpact)` where `status='CONVERTED_TO_CHANGE'`. Shows the value of inbound-email scope detection specifically.
- **Disputed dollars recovered:** `SUM(Invoice.totalAmount)` where `status='DISPUTED'` and there's a corresponding `EventAction.DISPUTE_RESOLVED` event for it. (May need a new `EventAction.DISPUTE_RESOLVED` enum value — flag as migration.)
- **Reconciliation variances caught:** count of `EventAction.INVOICE_FLAGGED` events in the last quarter. Shows the volume of catches.
- **Time-saved estimate:** `(scope creep caught $$ + disputed $$ recovered) / 2` as a heuristic for "without CGT Sync, you'd have spent N hours arguing". Optional, may be too cute.

UI (`src/components/dashboard/ExecutiveDashboard.tsx` extension):

- Top-of-page hero card: "Value protected this quarter" — single big $$ number + sparkline trend
- Three side-by-side cards below: "Scope creep caught", "Disputes prevented", "Variances flagged"
- Trend line: monthly $$ caught over the last 6 months
- Each metric clickable → navigates to filtered audit log view

### Critical files

- `prisma/schema.prisma` — possibly add `EventAction.DISPUTE_RESOLVED` enum value (migration if so)
- **NEW** `src/app/api/audit/route.ts`
- `src/components/layout/AuditDrawer.tsx` — wire to org-scoped data
- `src/app/api/dashboard/executive/route.ts` — extend with ROI aggregations
- `src/components/dashboard/ExecutiveDashboard.tsx` — render new ROI cards

### Verification

- [ ] As Cellipont admin: open audit drawer → see only Cellipont's events (no other tenants)
- [ ] Filter by action=BASELINE_LOCKED → see only baseline lock events
- [ ] Click a row → navigate to the affected entity
- [ ] Executive dashboard shows hero "Value protected" with real $$ from Cellipont's data
- [ ] As another tenant: see different (or zero) values, never Cellipont's

---

## Phase B1 — Supabase backup/restore runbook

### Context

Supabase auto-backs up the DB daily (Pro plan: 7-day PITR; Free: 1 daily snapshot). Recovery requires either Supabase support ticket or `pg_restore` from a manual export.

### Scope

- Document Supabase's automatic backup behavior in `docs/runbooks/backup-restore.md`
- Set up a weekly cron (Vercel cron job or GitHub Action) that runs `pg_dump` and uploads to S3 / Supabase Storage as a belt-and-suspenders backup
- Document the restore procedure (clone DB to staging, validate, point app at restored DB)
- Add `/admin/health` widget showing last backup timestamp + size

### Critical files

- **NEW** `docs/runbooks/backup-restore.md`
- **NEW** `scripts/pg_dump_backup.ts` (run by Vercel cron or GitHub Action)
- **NEW** `.github/workflows/weekly-db-backup.yml` (or Vercel cron config)
- `src/app/(dashboard)/admin/health/page.tsx` — add backup status section

### Verification

- [ ] Trigger weekly cron manually → backup file appears in storage
- [ ] Restore-test: create a staging Supabase project, run `pg_restore` from the backup, verify table counts match
- [ ] `/admin/health` shows "last backup: X minutes ago"

---

## Phase B2 — Production monitoring + customer-value tracking

### Context

Today there's no error tracking, no failed-inbound-email alerting, no slow-query monitoring. If Cellipont hits a bug at 2 AM, Samir won't know until they email.

The user also wants a **platform-admin view of customer value delivered** — "how much $$ has CGT Sync caught for each tenant?" — to (a) prove ROI to the customer and (b) prove the product works internally.

### Scope

**Error tracking:**
- Install Sentry (or PostHog with errors). Sentry is the SaaS standard.
- Wire up `@sentry/nextjs` per their Next.js setup
- Capture all unhandled errors + tag with `orgId` from tenant headers
- Slack webhook for new error groups

**Operational alerts:**
- Failed inbound emails: query `InboundEmail` where `status='FAILED'` in last hour; alert if > 0
- Resend webhook bounces: query `EmailLog` where `status='BOUNCED'` in last hour
- Slow queries: Supabase has built-in slow-query log; route to Slack daily digest
- Scope analysis job failures: query `ExtractionJob` where `status='FAILED'`

Implementation: scheduled Vercel cron (e.g. every 15 min) that posts to Slack via webhook when thresholds breached.

**Platform-admin "customer value" dashboard:**
- New page `/admin/value` — for each tenant org, show:
  - Total $$ scope creep caught
  - Total $$ disputes prevented
  - Total inbound emails processed (volume = engagement)
  - Number of changes confirmed
  - Change confirmation rate (CONFIRMED / RELEASED)
- Sortable table; export CSV
- Used internally to prove product impact + as marketing collateral

### Critical files

- `package.json` — add `@sentry/nextjs`
- **NEW** `sentry.client.config.ts` + `sentry.server.config.ts` + `sentry.edge.config.ts`
- **NEW** `src/app/api/admin/alerts/route.ts` — cron-triggered, scans for failures, posts to Slack
- **NEW** `.github/workflows/cron-alerts.yml` (or Vercel cron)
- **NEW** `src/app/(dashboard)/admin/value/page.tsx` — platform-admin value dashboard
- `src/lib/server/auth.ts` — `requirePlatformAdmin` already gates this
- Env: `SENTRY_DSN`, `SLACK_ALERT_WEBHOOK`

### Verification

- [ ] Trigger an error in a route → Sentry receives it, tagged with orgId
- [ ] Manually fail an inbound email → cron triggers Slack alert within 15 min
- [ ] `/admin/value` shows real per-tenant $$ for Cellipont (and any future tenants)
- [ ] Export CSV → opens cleanly in Excel

---

## Phase B3 — Multi-org user model for support staff

### Context

`OrgMember` schema already supports composite `(orgId, userId)` — a user can join multiple orgs. Code today uses `findFirst` to pick a single org (single-org assumption). When MT_MODE is ON (post-PR #19), the dashboard layout looks up membership by `(orgId from subdomain, userId)`.

**The use case:** Samir wants to debug for Jennifer at Cellipont without logging in as Jennifer. Today Samir has to ask Jennifer for her credentials or use Supabase admin to impersonate. Both are bad.

### Scope

**Approach: "support staff" multi-org membership.**

- Add `User.isSupportStaff Boolean @default(false)` to schema
- Support staff (e.g. Samir) get OrgMember rows in every tenant they need to debug, with a special `OrgRole.SUPPORT` (new enum value) — read-only or read+limited-write
- When a support staff signs in on `cellipont.cgtsync.ai`, they see Cellipont's data with a banner: "Acting as: Cellipont (support mode). All actions logged."
- Every action by a support staff is audit-logged with a special `EventLog.metadata.supportImpersonation = true` flag

**Alternative considered: explicit "log in as" flow.** Samir on `admin.cgtsync.ai` clicks "log in as Jennifer" → spawns a session for Jennifer at `cellipont.cgtsync.ai`. More complex; requires session management. Defer to v2 if SUPPORT role works.

### Critical files

- `prisma/schema.prisma` — `User.isSupportStaff` + `OrgRole.SUPPORT` enum value (additive migration)
- `src/lib/server/auth.ts` — extend role hierarchy: SUPPORT = read-only by default, plus a per-action allowlist for limited writes (e.g. can re-trigger extraction jobs but can't release a baseline)
- `src/app/(dashboard)/layout.tsx` — render banner when `auth.role === 'SUPPORT'`
- `src/components/layout/SupportBanner.tsx` (new)
- Audit log filter: support actions tagged
- **NEW** `/api/admin/support-access/route.ts` — platform admin endpoint to add/remove support OrgMember rows for any org

### Verification

- [ ] Add Samir as `OrgRole.SUPPORT` in Cellipont via `/admin/tenants` → Samir sees Cellipont in his org list
- [ ] Samir signs in at `cellipont.cgtsync.ai` → sees Cellipont's data with "Acting as Cellipont (support)" banner
- [ ] Samir tries to release a baseline → blocked with "Support mode read-only for this action"
- [ ] Samir re-triggers an extraction job → succeeds; EventLog has `supportImpersonation=true`
- [ ] Cellipont's actual admin sees Samir's actions in their audit drawer with the support flag

---

## Cross-cutting decisions

- **Migration deploy pattern**: every additive enum/column migration in this roadmap follows the same flow as Tier 1 — apply via Supabase SQL editor before merging code. Listed in each phase's "preconditions".
- **Branch naming**: keep using `claude/<topic>` per phase. One PR per phase (A1, A2, ...) so each can be reviewed + reverted independently.
- **No automated testing** added in this roadmap — codebase has no test suite. If the user wants tests, that's a separate phase. For now, manual verification per the checklists.
- **Tenant data isolation**: with MT_MODE flipped to true (PR #19), every API route already cross-checks tenant subdomain. New endpoints (audit, branding, etc.) inherit the helpers and stay safe by construction.

## Where to start in a fresh session

1. Open this plan file.
2. Read the "Phase A1" section.
3. Branch off `origin/claude/build-cgt-sync-v1-j6iPE` (or whatever the current production branch is — check `git remote show origin`).
4. Execute A1 step-by-step per the "Critical files" + "Verification" lists.
5. Open PR, get user to merge, move to A2.

If the user wants to skip ahead to a different phase, every phase is self-contained — just start there.

---
