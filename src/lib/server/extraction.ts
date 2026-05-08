/**
 * AI extraction service — uses Anthropic Claude to extract structured data
 * from evidence documents (PDFs, images, text files).
 *
 * Phase 4.1: Zod validation, parseWithRetry, provenance (excerpt/page/confidence).
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ExtractionTargetType } from "@/generated/prisma/client";
import { getSignedUrl } from "@/lib/server/storage";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const MAX_EXCERPT_WORDS = 40;
const MIN_EXCERPT_WORDS = 10;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey, maxRetries: 4 });
}

// ─── Provenance: every extracted row carries these ────────────

const ProvenanceSchema = z.object({
  excerpt: z.string().min(1),
  page: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

function normalizeExcerpt(raw: string): string {
  const words = raw.trim().split(/\s+/);
  if (words.length > MAX_EXCERPT_WORDS) return words.slice(0, MAX_EXCERPT_WORDS).join(" ") + "...";
  if (words.length < MIN_EXCERPT_WORDS) return raw.trim();
  return raw.trim();
}

// ─── Zod schemas per target type ─────────────────────────────

const CLAUSE_TYPES = ["PRICING", "TIMELINE", "SCOPE", "QUALITY", "REGULATORY", "PAYMENT_TERMS", "IP", "OTHER"] as const;

const BaselineClauseRow = z.object({
  clauseRef: z.string().nullable().optional(),
  type: z.enum(CLAUSE_TYPES).catch("OTHER"),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  value: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  quantity: z.number().positive().nullable().optional().default(1),
  isOptional: z.boolean().nullable().optional().default(false),
  scopeTier: z.string().nullable().optional(),
  excerpt: z.string().min(1),
  page: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

const StatedTotalRow = z.object({
  label: z.string().min(1),
  value: z.number(),
  scopeTier: z.string().nullable().optional(),
  isPrimary: z.boolean().nullable().optional().default(false),
  excludesDiscounts: z.boolean().nullable().optional().default(false),
  excerpt: z.string().min(1),
  page: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const BaselineExtractionSchema = z.object({
  documentTitle: z.string().nullable().optional(),
  documentDate: z.string().nullable().optional(),
  parties: z.array(z.string()).optional().default([]),
  clauses: z.array(BaselineClauseRow).min(1),
  statedTotals: z.array(StatedTotalRow).optional().default([]),
  summary: z.string().nullable().optional(),
});

const InvoiceLineItemRow = z.object({
  description: z.string().min(1),
  quantity: z.number().nullable().optional(),
  unitPrice: z.number().nullable().optional(),
  amount: z.number(),
  excerpt: z.string().min(1),
  page: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const InvoiceExtractionSchema = z.object({
  invoiceNumber: z.string().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  currency: z.string().optional().default("USD"),
  totalAmount: z.number().nullable().optional(),
  lineItems: z.array(InvoiceLineItemRow),
  notes: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
});

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

const AffectedClauseRow = z.object({
  clauseRef: z.string(),
  originalValue: z.string().nullable().optional(),
  newValue: z.string().nullable().optional(),
  changeType: z.enum(["AMENDMENT", "ADDITION", "REMOVAL"]).catch("AMENDMENT"),
  excerpt: z.string().min(1),
  page: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const ChangeOrderExtractionSchema = z.object({
  changeTitle: z.string().min(1),
  description: z.string().nullable().optional(),
  severity: z.enum(SEVERITIES).catch("MEDIUM"),
  estimatedImpact: z.number().nullable().optional(),
  impactCurrency: z.string().optional().default("USD"),
  effectiveDate: z.string().nullable().optional(),
  affectedClauses: z.array(AffectedClauseRow).optional().default([]),
  justification: z.string().nullable().optional(),
  approvals: z.array(z.string()).optional().default([]),
  summary: z.string().nullable().optional(),
  excerpt: z.string().min(1),
  page: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

const TERM_TYPES = [
  "RESERVATION_FEE", "COMMITMENT_DATE", "PAYMENT_MILESTONE",
  "CANCELLATION_WINDOW", "PENALTY_RULE", "MATERIAL_ORDER_TRIGGER",
] as const;

const TermRow = z.object({
  termType: z.enum(TERM_TYPES).catch("COMMITMENT_DATE"),
  label: z.string().min(1),
  dateOrOffset: z.string().nullable().optional(),
  costOrPercent: z.string().nullable().optional(),
  conditions: z.string().nullable().optional(),
  excerpt: z.string().min(1),
  page: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const TermsExtractionSchema = z.object({
  documentTitle: z.string().nullable().optional(),
  documentDate: z.string().nullable().optional(),
  parties: z.array(z.string()).optional().default([]),
  terms: z.array(TermRow).min(1),
  summary: z.string().nullable().optional(),
});

// ─── Transcript extraction: multi-candidate scope changes ────

const CandidateChangeRow = z.object({
  changeTitle: z.string().min(1),
  description: z.string().nullable().optional(),
  severity: z.enum(SEVERITIES).catch("MEDIUM"),
  estimatedImpact: z.number().nullable().optional(),
  scheduleImpactDays: z.number().int().nullable().optional(),
  speaker: z.string().nullable().optional(),
  excerpt: z.string().min(1),
  page: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const TranscriptExtractionSchema = z.object({
  meetingTitle: z.string().nullable().optional(),
  meetingDate: z.string().nullable().optional(),
  participants: z.array(z.string()).optional().default([]),
  candidates: z.array(CandidateChangeRow).min(1),
  summary: z.string().nullable().optional(),
});

export type TranscriptExtraction = z.infer<typeof TranscriptExtractionSchema>;

// ─── Email extraction: multi-candidate scope changes from a thread ───
//
// Emails commonly bundle several distinct items in one message
// ("additional training run planned for august / evaluate two more
// engineering runs") — the schema must support multiple candidates so each
// reaches scope analysis independently.

export const EmailExtractionSchema = z.object({
  sender: z.string().nullable().optional(),
  senderRole: z.string().nullable().optional(),
  dateSent: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  proposedBy: z.string().nullable().optional(),
  candidates: z.array(CandidateChangeRow).min(1),
  summary: z.string().nullable().optional(),
});

export type EmailExtraction = z.infer<typeof EmailExtractionSchema>;

export type BaselineExtraction = z.infer<typeof BaselineExtractionSchema>;
export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;
export type ChangeOrderExtraction = z.infer<typeof ChangeOrderExtractionSchema>;
export type TermsExtraction = z.infer<typeof TermsExtractionSchema>;

function getSchemaForTarget(targetType: ExtractionTargetType): z.ZodTypeAny {
  switch (targetType) {
    case "BASELINE": return BaselineExtractionSchema;
    case "INVOICE": return InvoiceExtractionSchema;
    case "CHANGE_ORDER": return ChangeOrderExtractionSchema;
    case "CHANGE_TRANSCRIPT": return TranscriptExtractionSchema;
    case "CHANGE_EMAIL": return EmailExtractionSchema;
    case "TERMS": return TermsExtractionSchema;
    case "SCOPE_ANALYSIS": return TranscriptExtractionSchema;
  }
}

// ─── Prompt templates with provenance requirements ───────────

const PROVENANCE_INSTRUCTION = `
IMPORTANT — Provenance Requirements:
For EVERY extracted item/row, you MUST include:
- "excerpt": A verbatim quote from the document (10–40 words) that supports the extracted data.
- "page": The page number where this item appears (integer, or null if unknown).
- "confidence": Your confidence in this extraction from 0.0 to 1.0 (e.g., 0.95 for clear text, 0.6 for inferred).`;

const BASELINE_PROMPT = `You are an expert contract analyst for biopharma outsourcing agreements. Extract ONLY the invoice-relevant terms from this document — the items a finance team would use to verify and reconcile invoices.

FOCUS ON extracting:
- PRICING: Every distinct cost, fee, rate, or price (manufacturing costs, testing fees, storage charges, pass-through costs, etc.)
- PAYMENT_TERMS: Payment schedules, net terms, milestone payments, invoicing frequency
- TIMELINE: Key delivery timelines and lead times that affect payment milestones
- SCOPE: Core deliverables that have associated costs (e.g., "10 batches per year", "stability testing included")

DO NOT extract:
- Legal/boilerplate clauses (indemnification, liability caps, limitation of liability, warranties)
- IP ownership, confidentiality, or data protection clauses
- Governing law, jurisdiction, or dispute resolution
- Force majeure, termination, or assignment clauses
- Insurance requirements, representations, or general obligations
- Regulatory compliance clauses (unless they specify billable activities with costs)
Exception: Include any of the above ONLY if they contain a specific dollar amount or payment obligation.

A typical SOW/WO should produce 8-20 baseline items. Focus on quality over quantity.

For each item, provide:
- clauseRef: The section/clause reference number (e.g., "3.1", "Schedule A, Item 2")
- type: One of PRICING, TIMELINE, SCOPE, PAYMENT_TERMS
- title: Short descriptive title (e.g., "API manufacturing price per batch")
- description: Full text or summary of the clause
- value: Numeric value — REQUIRED for PRICING, TIMELINE, and PAYMENT_TERMS. Extract the primary dollar amount, duration, or numeric term. Use null ONLY if the clause is purely descriptive with no numbers at all.
- unit: Unit for the value (e.g., "USD", "USD/batch", "USD/kg", "days", "weeks", "kg"). REQUIRED whenever value is set.
- quantity: How many times this line is included in the contracted total. Default 1. See "Quantity from footnotes" below.
- isOptional: true if the line is explicitly excluded from the contracted total. See "Optional items" below.
- scopeTier: The named phase/tier this line belongs to (e.g., "Tech Transfer", "GMP Manufacturing"), or null. See "Scope tier" below.
${PROVENANCE_INSTRUCTION}

CRITICAL — Value Extraction Rules:
- For PRICING clauses: ALWAYS extract the numeric price. E.g., "$285,000 per batch" → value: 285000, unit: "USD/batch"
- For TIMELINE clauses: ALWAYS extract numeric durations. E.g., "12 weeks lead time" → value: 12, unit: "weeks"
- For PAYMENT_TERMS clauses: ALWAYS extract numeric terms. E.g., "Net 45 days" → value: 45, unit: "days". For milestone payments, e.g., "50% upfront" → value: 50, unit: "%"
- For tiered/volume pricing, extract each tier as a SEPARATE clause with its own value
- If a value is a range, use the midpoint
- Do NOT leave value as null if any numeric figure appears in the clause text
- Extract EVERY pricing line, payment term, and timeline clause as separate items — do NOT combine multiple items into one clause

CRITICAL — Quantity from footnotes & scope statements:
- Pricing tables in SOWs often list a unit price ("$169,100 per DS Engineering Run") and specify a quantity in a footnote, parenthetical, scope summary, or adjacent column ("Two (2) DS Engineering Runs", "Nine (9) Months of PM Monthly Fees", "Three (3) APS Runs").
- For each pricing line, set "quantity" to the multiplier stated in the document. If no quantity is stated, set quantity: 1.
- The line's contribution to a total = value × quantity. Quantity must be an exact match to the number in the document — do NOT split the unit price across multiple clauses.
- Example: "DS Engineering Run: $169,100/run" with footnote "Estimated price includes Two (2) DS Engineering Runs" → value: 169100, unit: "USD/run", quantity: 2.

CRITICAL — Optional items:
- Mark "isOptional": true for any item explicitly described as optional, contingent, "if requested", "as needed", or excluded from the contracted total. Look for markers like "(Optional)", "Not included in Pricing & Timeline", "Optional – Not included", "if requested by Client".
- Otherwise set isOptional: false. When in doubt, prefer false — under-marking optional is safer than over-marking, since over-marking hides real billable work.

CRITICAL — Discounts as negative PRICING clauses:
- Executive discounts, volume discounts, credits, rebates, and any negative line items must be extracted as a PRICING clause with "value" as a NEGATIVE number.
- Example: "Executive Discount: −$200,000" → value: -200000, unit: "USD", quantity: 1, type: "PRICING".
- This is required so that reconciliation against after-discount stated totals sums correctly. Do NOT skip discount lines.
- Discount scopeTier attribution: read the SOW carefully to determine which scope tier the discount applies to. If the document says the discount is applied to a specific item (e.g., "Executive Discount applied to GMP Suite Fee for DS Engineering Run #1") and that item belongs to a tier (e.g., "Tech Transfer"), set the discount line's scopeTier to that tier. If the discount applies to the contract overall and the SOW doesn't tie it to a tier, leave scopeTier: null.

Scope tier:
- If the SOW separates work into named phases or scope tiers (e.g., "Tech Transfer" subtotal vs. "GMP Manufacturing" subtotal vs. an after-discount grand total), set "scopeTier" on each line to the tier name it belongs to. Footnotes commonly indicate this ("Estimated Tech Transfer Price includes: Two (2) DS Engineering Runs..." → scopeTier: "Tech Transfer" on those lines).
- The grand total typically has no scopeTier (covers all lines). If the document is single-tier, leave scopeTier: null on all lines.

CRITICAL — Stated totals (top-level reconciliation targets):
- Find every grand total, subtotal, phase total, after-discount total, and signed contract value stated in the document — in pricing tables, footers, signature blocks, or summary sections.
- Return them in a top-level "statedTotals" array. Each entry: { label, value, scopeTier?, isPrimary?, excludesDiscounts?, excerpt, page, confidence }.
- Examples of labels: "Total Estimated Tech Transfer Price", "Total Estimated Price", "Total Estimated Price after Discount", "Grand Total".
- Set "isPrimary": true on EXACTLY ONE entry — the signed contract value. This is typically the after-discount total or the final/grand total. If only one total exists, mark it primary. If multiple totals exist, the after-discount or final-signed total wins.
- Set scopeTier on a stated total when it covers a named phase (e.g., "Total Estimated Tech Transfer Price" → scopeTier: "Tech Transfer"). The grand total has no scopeTier.

CRITICAL — pre-discount vs. after-discount totals:
- Many SOWs list a gross total ABOVE the discount line and a net total BELOW it. Both are "stated totals" but they reconcile differently — a discount-aware sum will under-shoot the gross by the discount amount.
- Set "excludesDiscounts": true on a stated total when it represents the gross/pre-discount/list-price number (typically presented BEFORE the discount line in the pricing table, no "after discount" / "net" wording).
- Set "excludesDiscounts": false (or omit it) on totals that are net of discounts (the signed contract value, "Total Estimated Price after Discount", "Net Price", "Final Price"). Default is false.
- Heuristic: read the document order. A subtotal listed above the discount line is almost always pre-discount (excludesDiscounts: true). A subtotal listed below the discount line, or labeled "after discount" / "net" / "final", is post-discount (excludesDiscounts: false).
- Worked example: a SOW shows "Total Estimated Price: $3,105,600" → "Executive Discount: −$200,000" → "Total Estimated Price after Discount: $2,820,000". The first total has excludesDiscounts: true; the third has excludesDiscounts: false and isPrimary: true.

Return a JSON object with this exact structure:
{
  "documentTitle": "Title of the document",
  "documentDate": "Date if found, or null",
  "parties": ["Party A name", "Party B name"],
  "clauses": [
    {
      "clauseRef": "5.2",
      "type": "PRICING",
      "title": "DS Engineering Run",
      "description": "DS Engineering Run at $169,100 per run; footnote specifies two runs included in Tech Transfer scope",
      "value": 169100,
      "unit": "USD/run",
      "quantity": 2,
      "isOptional": false,
      "scopeTier": "Tech Transfer",
      "excerpt": "verbatim quote including footnote...",
      "page": 4,
      "confidence": 0.93
    },
    {
      "clauseRef": "Discount",
      "type": "PRICING",
      "title": "Executive Discount",
      "description": "Executive discount of $200,000 applied to total estimated price",
      "value": -200000,
      "unit": "USD",
      "quantity": 1,
      "isOptional": false,
      "scopeTier": null,
      "excerpt": "Executive Discount: ($200,000)",
      "page": 5,
      "confidence": 0.97
    },
    {
      "clauseRef": "7.1",
      "type": "PAYMENT_TERMS",
      "title": "Payment terms",
      "description": "Payment due within 45 days of invoice date",
      "value": 45,
      "unit": "days",
      "quantity": 1,
      "isOptional": false,
      "scopeTier": null,
      "excerpt": "verbatim quote from document...",
      "page": 7,
      "confidence": 0.90
    }
  ],
  "statedTotals": [
    {
      "label": "Total Estimated Tech Transfer Price",
      "value": 2484200,
      "scopeTier": "Tech Transfer",
      "isPrimary": false,
      "excludesDiscounts": true,
      "excerpt": "Total Estimated Tech Transfer Price: $2,484,200",
      "page": 5,
      "confidence": 0.98
    },
    {
      "label": "Total Estimated Price",
      "value": 3105600,
      "scopeTier": null,
      "isPrimary": false,
      "excludesDiscounts": true,
      "excerpt": "Total Estimated Price: $3,105,600",
      "page": 5,
      "confidence": 0.98
    },
    {
      "label": "Total Estimated Price after Discount",
      "value": 2820000,
      "scopeTier": null,
      "isPrimary": true,
      "excludesDiscounts": false,
      "excerpt": "Total Estimated Price after Discount: $2,820,000",
      "page": 5,
      "confidence": 0.98
    }
  ],
  "summary": "Brief 1-2 sentence summary of the document"
}

Focus on terms that would appear as line items on an invoice or that define payment obligations. Quality over quantity. Return ONLY valid JSON, no markdown fences.`;

const INVOICE_PROMPT = `You are an expert invoice analyst for biopharma outsourcing. Extract the invoice header and all line items from this document.
${PROVENANCE_INSTRUCTION}

Return a JSON object with this exact structure:
{
  "invoiceNumber": "INV-12345 or null if not found",
  "vendorName": "Vendor/supplier name or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "currency": "USD or other currency code",
  "totalAmount": 123456.78,
  "lineItems": [
    {
      "description": "Description of line item",
      "quantity": 100,
      "unitPrice": 50.00,
      "amount": 5000.00,
      "excerpt": "verbatim quote from document...",
      "page": 1,
      "confidence": 0.9
    }
  ],
  "notes": "Any relevant notes or terms on the invoice",
  "summary": "Brief 1-2 sentence summary"
}

Extract ALL line items. For quantity/unitPrice, use null if not separately listed. The amount should always be present. Return ONLY valid JSON, no markdown fences.`;

const CHANGE_ORDER_PROMPT = `You are an expert at analyzing change orders and amendments for biopharma outsourcing contracts. Extract the change details from this document.
${PROVENANCE_INSTRUCTION}

Return a JSON object with this exact structure:
{
  "changeTitle": "Brief title of the change",
  "description": "Full description of what changed",
  "severity": "LOW, MEDIUM, HIGH, or CRITICAL based on financial/timeline impact",
  "estimatedImpact": 50000.00,
  "impactCurrency": "USD",
  "effectiveDate": "YYYY-MM-DD or null",
  "affectedClauses": [
    {
      "clauseRef": "Original clause reference being modified",
      "originalValue": "What it was before",
      "newValue": "What it is now",
      "changeType": "AMENDMENT, ADDITION, or REMOVAL",
      "excerpt": "verbatim quote from document...",
      "page": 2,
      "confidence": 0.85
    }
  ],
  "justification": "Reason for the change",
  "approvals": ["Names/roles of approvers mentioned"],
  "summary": "Brief 1-2 sentence summary",
  "excerpt": "main verbatim quote from document...",
  "page": 1,
  "confidence": 0.9
}

Return ONLY valid JSON, no markdown fences.`;

const TERMS_PROMPT = `You are an expert contract analyst specializing in biopharma CDMO outsourcing commitments. Extract all commitment terms, deadlines, and financial obligations from this document.

For each term, identify the term_type:
- RESERVATION_FEE: Upfront fees to reserve capacity or slots
- COMMITMENT_DATE: Hard deadlines the sponsor must meet (e.g., "confirm order by 2025-06-01")
- PAYMENT_MILESTONE: Payment due at a specific stage (e.g., "50% upon batch release")
- CANCELLATION_WINDOW: Deadline to cancel without penalty
- PENALTY_RULE: Financial penalty triggered by an event (e.g., "2% per week late")
- MATERIAL_ORDER_TRIGGER: Deadline/condition that triggers material procurement

For each term, provide:
- termType: One of the types above
- label: Short descriptive label (e.g., "Reservation fee due", "Batch 1 commitment deadline")
- dateOrOffset: Date (YYYY-MM-DD) or relative offset (e.g., "+90 days from contract signing")
- costOrPercent: Financial impact (e.g., "$150,000", "2% per week", "50% of batch cost")
- conditions: Any conditions or triggers (e.g., "if sponsor cancels after material order")
${PROVENANCE_INSTRUCTION}

Return a JSON object with this exact structure:
{
  "documentTitle": "Title of the document",
  "documentDate": "Date if found, or null",
  "parties": ["Party A name", "Party B name"],
  "terms": [
    {
      "termType": "COMMITMENT_DATE",
      "label": "Batch 1 order confirmation deadline",
      "dateOrOffset": "2025-06-01",
      "costOrPercent": null,
      "conditions": "Must confirm in writing to manufacturing team",
      "excerpt": "verbatim quote from document...",
      "page": 4,
      "confidence": 0.9
    }
  ],
  "summary": "Brief 1-2 sentence summary of key commitment obligations"
}

Extract ALL identifiable commitment terms, deadlines, and financial obligations. Be thorough. Return ONLY valid JSON, no markdown fences.`;

const CHANGE_TRANSCRIPT_PROMPT = `You are an expert at analyzing meeting transcripts and notes for biopharma outsourcing programs. Your job is to find ALL potential scope changes, cost impacts, and action items that could affect the contract.

Scan the transcript for phrases like:
- "action item", "agreed to", "we decided", "let's add", "need to change"
- Cost mentions: dollar amounts, budget discussions, "additional cost", "extra charge"
- Schedule impacts: "delay", "push back", "ahead of schedule", "extra days/weeks"
- Risk items: "risk", "concern", "issue", "problem"
- Scope changes: "out of scope", "scope creep", "additional work", "not in the SOW"

For EACH potential change, extract:
- changeTitle: Brief title (e.g., "Add nitrogen overlay system to bioreactor")
- description: What was discussed/agreed
- severity: LOW (minor), MEDIUM (moderate impact), HIGH (significant), CRITICAL (project-threatening)
- estimatedImpact: Dollar amount if mentioned, or null
- scheduleImpactDays: Number of days impact if mentioned, or null
- speaker: Who proposed or mentioned this change (name if available)
${PROVENANCE_INSTRUCTION}

Return a JSON object with this exact structure:
{
  "meetingTitle": "Meeting title if mentioned, or null",
  "meetingDate": "YYYY-MM-DD or null",
  "participants": ["Name 1", "Name 2"],
  "candidates": [
    {
      "changeTitle": "Add nitrogen overlay system",
      "description": "Team agreed to add nitrogen overlay...",
      "severity": "MEDIUM",
      "estimatedImpact": 45000,
      "scheduleImpactDays": 5,
      "speaker": "J. Smith",
      "excerpt": "verbatim quote from transcript...",
      "page": null,
      "confidence": 0.85
    }
  ],
  "summary": "Brief summary of meeting scope change discussions"
}

Be thorough — extract ALL potential scope changes, even uncertain ones. Use lower confidence (0.3-0.5) for items that are uncertain or just mentioned in passing. Return ONLY valid JSON, no markdown fences.`;

const CHANGE_EMAIL_PROMPT = `You are an expert at analyzing email threads for biopharma outsourcing programs. Extract EVERY distinct scope, schedule, or cost item being proposed, raised, asked about, or agreed to in this email — emails frequently bundle multiple items in one message and each must be evaluated independently against the baseline.

Look for:
- Proposed cost changes: "additional charge", "revised quote", "cost increase"
- Schedule changes: "delay", "timeline change", "new date"
- Scope modifications: "additional work", "change request", "amendment", "additional run", "extra batch"
- Evaluations / open questions about future work: "evaluate need for X", "considering Y", "may need Z"
- Agreements or approvals: "approved", "confirmed", "agreed"

CRITICAL — multi-candidate extraction:
- Treat each distinct item as a SEPARATE candidate. "Additional training run planned for August" and "Evaluate need for two engineering runs after the first one" are TWO candidates, not one — even when they appear in the same email body.
- Bullet points, separate paragraphs, separate sentences with different subjects/objects, and follow-up replies in a thread are signals of distinct candidates.
- Emails that contain only pleasantries / signatures / no scope-relevant content should still return a candidates array (with a single low-confidence "no actionable change" item is acceptable, but only if truly nothing actionable is present). Prefer extracting too many low-confidence candidates over missing one.
${PROVENANCE_INSTRUCTION}

Return a JSON object with this exact structure:
{
  "sender": "Name of the email sender or null",
  "senderRole": "Role/company of sender or null",
  "dateSent": "YYYY-MM-DD or null",
  "subject": "Email subject line or null",
  "proposedBy": "Who is proposing/raising these items (often the same as sender)",
  "candidates": [
    {
      "changeTitle": "Brief title of one specific item",
      "description": "Full description of what is being proposed/changed/asked",
      "severity": "LOW, MEDIUM, HIGH, or CRITICAL",
      "estimatedImpact": 5000.00,
      "scheduleImpactDays": 3,
      "speaker": "Name of person raising this item, often = sender",
      "excerpt": "verbatim quote from the email body that supports this item (10-40 words)",
      "page": 1,
      "confidence": 0.85
    }
  ],
  "summary": "Brief 1-2 sentence summary of what the email contains"
}

The candidates array must contain at least one entry. Return ONLY valid JSON, no markdown fences.`;

function getPromptForTarget(targetType: ExtractionTargetType): string {
  switch (targetType) {
    case "BASELINE": return BASELINE_PROMPT;
    case "INVOICE": return INVOICE_PROMPT;
    case "CHANGE_ORDER": return CHANGE_ORDER_PROMPT;
    case "CHANGE_TRANSCRIPT": return CHANGE_TRANSCRIPT_PROMPT;
    case "CHANGE_EMAIL": return CHANGE_EMAIL_PROMPT;
    case "TERMS": return TERMS_PROMPT;
    case "SCOPE_ANALYSIS": return CHANGE_TRANSCRIPT_PROMPT;
  }
}

// ─── File download ───────────────────────────────────────────

async function downloadFile(storagePath: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const signedUrl = await getSignedUrl(storagePath, 120);
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`Failed to download evidence file: ${res.statusText}`);
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType: contentType };
}

// ─── JSON parsing with retry ─────────────────────────────────

function extractJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try extracting from complete markdown code fences
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());

    // Handle truncated responses where closing ``` is missing
    const openFence = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*)$/);
    if (openFence) {
      const inner = openFence[1].replace(/\n?```\s*$/, "").trim();
      return JSON.parse(inner);
    }

    throw new Error(`Not valid JSON: ${trimmed.slice(0, 200)}`);
  }
}

async function callClaude(
  client: Anthropic,
  model: string,
  contentBlocks: Anthropic.ContentBlockParam[],
): Promise<{ raw: string; usage: { input_tokens: number; output_tokens: number } }> {
  const response = await client.messages.create({
    model,
    max_tokens: 16384,
    messages: [{ role: "user", content: contentBlocks }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("No text response from extraction model");
  return {
    raw: textBlock.text,
    usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0 },
  };
}

export interface ParseWithRetryResult {
  data: Record<string, unknown>;
  totalInputTokens: number;
  totalOutputTokens: number;
  retried: boolean;
}

async function parseWithRetry(
  client: Anthropic,
  model: string,
  contentBlocks: Anthropic.ContentBlockParam[],
  schema: z.ZodTypeAny,
): Promise<ParseWithRetryResult> {
  const first = await callClaude(client, model, contentBlocks);
  let totalInput = first.usage.input_tokens;
  let totalOutput = first.usage.output_tokens;

  try {
    const parsed = extractJsonFromText(first.raw);
    const validated = schema.parse(parsed) as Record<string, unknown>;
    return { data: validated, totalInputTokens: totalInput, totalOutputTokens: totalOutput, retried: false };
  } catch (firstError) {
    // Re-throw API-level errors — SDK already retried these
    if (firstError instanceof Anthropic.APIError) throw firstError;

    // Retry once with error feedback (JSON/Zod validation errors only)
    const errMsg = firstError instanceof z.ZodError
      ? `Validation errors: ${firstError.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
      : firstError instanceof Error ? firstError.message : "Invalid JSON";

    const retryBlocks: Anthropic.ContentBlockParam[] = [
      ...contentBlocks,
      { type: "text", text: `Your previous response had errors:\n${errMsg}\n\nPlease fix and return ONLY valid JSON matching the required schema. Every item MUST have excerpt, page, and confidence fields.` },
    ];

    const second = await callClaude(client, model, retryBlocks);
    totalInput += second.usage.input_tokens;
    totalOutput += second.usage.output_tokens;

    const parsed = extractJsonFromText(second.raw);
    const validated = schema.parse(parsed) as Record<string, unknown>; // throws if still invalid
    return { data: validated, totalInputTokens: totalInput, totalOutputTokens: totalOutput, retried: true };
  }
}

// ─── Content block builder ───────────────────────────────────

function resolveImageMediaType(mimeType: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/gif") return "image/gif";
  if (mimeType === "image/webp") return "image/webp";
  return "image/jpeg";
}

function buildContentBlocks(
  buffer: Buffer,
  effectiveMime: string,
  prompt: string,
): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const base64Data = buffer.toString("base64");

  if (effectiveMime === "application/pdf") {
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64Data },
    });
  } else if (effectiveMime.startsWith("image/")) {
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: resolveImageMediaType(effectiveMime), data: base64Data },
    });
  } else {
    blocks.push({ type: "text", text: `Document content:\n\n${buffer.toString("utf-8")}` });
  }

  blocks.push({ type: "text", text: prompt });
  return blocks;
}

// ─── Normalize provenance on extracted data ──────────────────

function normalizeProvenance(data: Record<string, unknown>, evidenceId: string): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data, evidenceId };

  // Normalize excerpts in arrays
  const arrayKeys = ["clauses", "lineItems", "affectedClauses", "terms", "candidates", "statedTotals"];
  for (const key of arrayKeys) {
    const arr = result[key];
    if (Array.isArray(arr)) {
      result[key] = arr.map((item: Record<string, unknown>) => ({
        ...item,
        evidenceId,
        excerpt: typeof item.excerpt === "string" ? normalizeExcerpt(item.excerpt) : "",
        confidence: typeof item.confidence === "number" ? Math.min(1, Math.max(0, item.confidence)) : 0.5,
      }));
    }
  }

  // Top-level provenance for CHANGE_ORDER
  if (typeof result.excerpt === "string") {
    result.excerpt = normalizeExcerpt(result.excerpt as string);
  }
  if (typeof result.confidence === "number") {
    result.confidence = Math.min(1, Math.max(0, result.confidence as number));
  }

  return result;
}

// ─── Text-only Claude call (no document) ─────────────────────

/**
 * Call Claude with a text-only prompt and validate the response against a Zod schema.
 * Used by the reconciliation engine and other non-document AI features.
 */
export async function callClaudeWithSchema<T>(
  prompt: string,
  schema: z.ZodType<T>,
): Promise<{ data: T; tokensUsed: number }> {
  const client = getClient();
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const contentBlocks: Anthropic.ContentBlockParam[] = [{ type: "text", text: prompt }];
  const result = await parseWithRetry(client, model, contentBlocks, schema as z.ZodTypeAny);
  return {
    data: result.data as T,
    tokensUsed: result.totalInputTokens + result.totalOutputTokens,
  };
}

// ─── Main extraction entry point ─────────────────────────────

export interface ExtractionResult {
  extractedData: Record<string, unknown>;
  confidence: number;
  tokensUsed: number;
  modelUsed: string;
  retried: boolean;
}

export async function runExtraction(
  storagePath: string,
  mimeType: string,
  targetType: ExtractionTargetType,
  evidenceId: string,
): Promise<ExtractionResult> {
  const client = getClient();
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const prompt = getPromptForTarget(targetType);
  const schema = getSchemaForTarget(targetType);

  const { buffer, mimeType: actualMimeType } = await downloadFile(storagePath);
  const effectiveMime = mimeType || actualMimeType;
  const contentBlocks = buildContentBlocks(buffer, effectiveMime, prompt);

  const { data, totalInputTokens, totalOutputTokens, retried } = await parseWithRetry(
    client, model, contentBlocks, schema,
  );

  const normalized = normalizeProvenance(data as Record<string, unknown>, evidenceId);
  const tokensUsed = totalInputTokens + totalOutputTokens;
  const confidence = estimateConfidence(normalized, targetType);

  return { extractedData: normalized, confidence, tokensUsed, modelUsed: model, retried };
}

function estimateConfidence(data: Record<string, unknown>, targetType: ExtractionTargetType): number {
  let score = 0.5;

  switch (targetType) {
    case "BASELINE": {
      const clauses = data.clauses as unknown[];
      if (Array.isArray(clauses) && clauses.length > 0) score += 0.2;
      if (data.documentTitle) score += 0.1;
      if (data.parties && Array.isArray(data.parties) && (data.parties as unknown[]).length > 0) score += 0.1;
      if (data.summary) score += 0.1;
      break;
    }
    case "INVOICE": {
      const items = data.lineItems as unknown[];
      if (Array.isArray(items) && items.length > 0) score += 0.2;
      if (data.invoiceNumber) score += 0.1;
      if (data.vendorName) score += 0.1;
      if (data.totalAmount !== null && data.totalAmount !== undefined) score += 0.1;
      break;
    }
    case "CHANGE_ORDER": {
      if (data.changeTitle) score += 0.15;
      if (data.description) score += 0.15;
      if (data.severity) score += 0.1;
      if (data.estimatedImpact !== null && data.estimatedImpact !== undefined) score += 0.1;
      break;
    }
    case "CHANGE_TRANSCRIPT": {
      const candidates = data.candidates as unknown[];
      if (Array.isArray(candidates) && candidates.length > 0) score += 0.2;
      if (data.meetingTitle) score += 0.1;
      if (data.participants && Array.isArray(data.participants) && (data.participants as unknown[]).length > 0) score += 0.1;
      if (data.summary) score += 0.1;
      break;
    }
    case "CHANGE_EMAIL": {
      const candidates = data.candidates as unknown[];
      if (Array.isArray(candidates) && candidates.length > 0) score += 0.2;
      if (data.sender) score += 0.1;
      if (data.subject) score += 0.05;
      if (data.summary) score += 0.05;
      break;
    }
    case "TERMS": {
      const terms = data.terms as unknown[];
      if (Array.isArray(terms) && terms.length > 0) score += 0.2;
      if (data.documentTitle) score += 0.1;
      if (data.parties && Array.isArray(data.parties) && (data.parties as unknown[]).length > 0) score += 0.1;
      if (data.summary) score += 0.1;
      break;
    }
    case "SCOPE_ANALYSIS": {
      const candidates = data.candidates as unknown[];
      if (Array.isArray(candidates) && candidates.length > 0) score += 0.2;
      if (data.meetingTitle) score += 0.1;
      if (data.summary) score += 0.1;
      break;
    }
  }

  return Math.min(score, 1.0);
}
