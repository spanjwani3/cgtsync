/**
 * AI extraction service — uses Anthropic Claude to extract structured data
 * from evidence documents (PDFs, images, text files).
 */

import Anthropic from "@anthropic-ai/sdk";
import { ExtractionTargetType } from "@/generated/prisma/client";
import { getSignedUrl } from "@/lib/server/storage";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey });
}

// ─── Prompt templates per target type ────────────────────────

const BASELINE_PROMPT = `You are an expert contract analyst for biopharma outsourcing agreements. Extract all contract clauses/terms from this document.

For each clause, provide:
- clauseRef: The section/clause reference number (e.g., "3.1", "Schedule A, Item 2")
- type: One of PRICING, TIMELINE, SCOPE, QUALITY, REGULATORY, PAYMENT_TERMS, IP, OTHER
- title: Short descriptive title (e.g., "API manufacturing price per kg")
- description: Full text or summary of the clause
- value: Numeric value if applicable (e.g., price amounts, durations). Use null if not numeric.
- unit: Unit for the value (e.g., "USD", "days", "kg", "USD/kg"). Use null if no value.

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
      "unit": "USD"
    }
  ],
  "summary": "Brief 1-2 sentence summary of the document"
}

Extract ALL identifiable terms. Be thorough. If a value appears as a range, use the midpoint. Return ONLY valid JSON, no markdown fences.`;

const INVOICE_PROMPT = `You are an expert invoice analyst for biopharma outsourcing. Extract the invoice header and all line items from this document.

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
      "amount": 5000.00
    }
  ],
  "notes": "Any relevant notes or terms on the invoice",
  "summary": "Brief 1-2 sentence summary"
}

Extract ALL line items. For quantity/unitPrice, use null if not separately listed. The amount should always be present. Return ONLY valid JSON, no markdown fences.`;

const CHANGE_ORDER_PROMPT = `You are an expert at analyzing change orders and amendments for biopharma outsourcing contracts. Extract the change details from this document.

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
      "changeType": "AMENDMENT, ADDITION, or REMOVAL"
    }
  ],
  "justification": "Reason for the change",
  "approvals": ["Names/roles of approvers mentioned"],
  "summary": "Brief 1-2 sentence summary"
}

Return ONLY valid JSON, no markdown fences.`;

function getPromptForTarget(targetType: ExtractionTargetType): string {
  switch (targetType) {
    case "BASELINE":
      return BASELINE_PROMPT;
    case "INVOICE":
      return INVOICE_PROMPT;
    case "CHANGE_ORDER":
      return CHANGE_ORDER_PROMPT;
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

// ─── Claude API call ─────────────────────────────────────────

function resolveImageMediaType(mimeType: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/gif") return "image/gif";
  if (mimeType === "image/webp") return "image/webp";
  return "image/jpeg";
}

export interface ExtractionResult {
  extractedData: Record<string, unknown>;
  confidence: number;
  tokensUsed: number;
  modelUsed: string;
}

export async function runExtraction(
  storagePath: string,
  mimeType: string,
  targetType: ExtractionTargetType,
): Promise<ExtractionResult> {
  const client = getClient();
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const prompt = getPromptForTarget(targetType);

  const { buffer, mimeType: actualMimeType } = await downloadFile(storagePath);
  const base64Data = buffer.toString("base64");
  const effectiveMime = mimeType || actualMimeType;

  // Build content blocks based on file type
  const contentBlocks: Anthropic.ContentBlockParam[] = [];

  if (effectiveMime === "application/pdf") {
    contentBlocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64Data },
    });
  } else if (effectiveMime.startsWith("image/")) {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: resolveImageMediaType(effectiveMime),
        data: base64Data,
      },
    });
  } else {
    // Plain text / CSV / other text formats — send as text
    const textContent = buffer.toString("utf-8");
    contentBlocks.push({
      type: "text",
      text: `Document content:\n\n${textContent}`,
    });
  }

  contentBlocks.push({ type: "text", text: prompt });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content: contentBlocks }],
  });

  // Parse response
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from extraction model");
  }

  const rawText = textBlock.text.trim();
  let extractedData: Record<string, unknown>;
  try {
    extractedData = JSON.parse(rawText);
  } catch {
    // Try to extract JSON from possible markdown fences
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      extractedData = JSON.parse(jsonMatch[1].trim());
    } else {
      throw new Error(`Failed to parse extraction response as JSON: ${rawText.slice(0, 200)}`);
    }
  }

  const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  // Estimate confidence based on completeness of extracted data
  const confidence = estimateConfidence(extractedData, targetType);

  return { extractedData, confidence, tokensUsed, modelUsed: model };
}

function estimateConfidence(data: Record<string, unknown>, targetType: ExtractionTargetType): number {
  let score = 0.5; // base

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
