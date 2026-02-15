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
  return new Anthropic({ apiKey });
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
  excerpt: z.string().min(1),
  page: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const BaselineExtractionSchema = z.object({
  documentTitle: z.string().nullable().optional(),
  documentDate: z.string().nullable().optional(),
  parties: z.array(z.string()).optional().default([]),
  clauses: z.array(BaselineClauseRow).min(1),
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

export type BaselineExtraction = z.infer<typeof BaselineExtractionSchema>;
export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;
export type ChangeOrderExtraction = z.infer<typeof ChangeOrderExtractionSchema>;

function getSchemaForTarget(targetType: ExtractionTargetType): z.ZodTypeAny {
  switch (targetType) {
    case "BASELINE": return BaselineExtractionSchema;
    case "INVOICE": return InvoiceExtractionSchema;
    case "CHANGE_ORDER": return ChangeOrderExtractionSchema;
  }
}

// ─── Prompt templates with provenance requirements ───────────

const PROVENANCE_INSTRUCTION = `
IMPORTANT — Provenance Requirements:
For EVERY extracted item/row, you MUST include:
- "excerpt": A verbatim quote from the document (10–40 words) that supports the extracted data.
- "page": The page number where this item appears (integer, or null if unknown).
- "confidence": Your confidence in this extraction from 0.0 to 1.0 (e.g., 0.95 for clear text, 0.6 for inferred).`;

const BASELINE_PROMPT = `You are an expert contract analyst for biopharma outsourcing agreements. Extract all contract clauses/terms from this document.

For each clause, provide:
- clauseRef: The section/clause reference number (e.g., "3.1", "Schedule A, Item 2")
- type: One of PRICING, TIMELINE, SCOPE, QUALITY, REGULATORY, PAYMENT_TERMS, IP, OTHER
- title: Short descriptive title (e.g., "API manufacturing price per kg")
- description: Full text or summary of the clause
- value: Numeric value if applicable (e.g., price amounts, durations). Use null if not numeric.
- unit: Unit for the value (e.g., "USD", "days", "kg", "USD/kg"). Use null if no value.
${PROVENANCE_INSTRUCTION}

Return a JSON object with this exact structure:
{
  "documentTitle": "Title of the document",
  "documentDate": "Date if found, or null",
  "parties": ["Party A name", "Party B name"],
  "clauses": [
    {
      "clauseRef": "1.1",
      "type": "PRICING",
      "title": "...",
      "description": "...",
      "value": 50000,
      "unit": "USD",
      "excerpt": "verbatim quote from document...",
      "page": 3,
      "confidence": 0.95
    }
  ],
  "summary": "Brief 1-2 sentence summary of the document"
}

Extract ALL identifiable terms. Be thorough. If a value appears as a range, use the midpoint. Return ONLY valid JSON, no markdown fences.`;

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

function getPromptForTarget(targetType: ExtractionTargetType): string {
  switch (targetType) {
    case "BASELINE": return BASELINE_PROMPT;
    case "INVOICE": return INVOICE_PROMPT;
    case "CHANGE_ORDER": return CHANGE_ORDER_PROMPT;
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
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
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
    max_tokens: 4096,
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
    // Retry once with error feedback
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
  const arrayKeys = ["clauses", "lineItems", "affectedClauses"];
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
  }

  return Math.min(score, 1.0);
}
