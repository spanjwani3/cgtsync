/**
 * Inbound email content classifier — determines the type of content
 * received via email-in ingestion using keyword matching and AI fallback.
 */

import { z } from "zod";
import { callClaudeWithSchema } from "@/lib/server/extraction";

export type InboundContentType = "TRANSCRIPT" | "CHANGE_ORDER" | "INVOICE" | "EMAIL_THREAD" | "UNKNOWN";

// ─── Keyword-based first pass ────────────────────────────────

const TRANSCRIPT_KEYWORDS = [
  "meeting notes", "meeting minutes", "transcript", "meeting recap",
  "teams meeting", "zoom meeting", "action items from", "discussion notes",
  "sync notes", "weekly sync", "process development", "call notes",
];

const CHANGE_ORDER_KEYWORDS = [
  "change order", "amendment", "modification", "CO-", "change request",
  "scope change", "contract amendment", "change notice",
];

const INVOICE_KEYWORDS = [
  "invoice", "INV-", "payment", "billing", "remittance",
  "accounts payable", "amount due", "payment terms",
];

function keywordMatch(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
}

export function classifyByKeywords(subject: string, bodyText: string): {
  type: InboundContentType;
  confidence: number;
} {
  const combined = `${subject} ${bodyText.slice(0, 2000)}`;

  const transcriptScore = keywordMatch(combined, TRANSCRIPT_KEYWORDS);
  const changeScore = keywordMatch(combined, CHANGE_ORDER_KEYWORDS);
  const invoiceScore = keywordMatch(combined, INVOICE_KEYWORDS);

  const maxScore = Math.max(transcriptScore, changeScore, invoiceScore);

  if (maxScore === 0) {
    return { type: "UNKNOWN", confidence: 0 };
  }

  // Need at least 2 keyword matches or 1 strong match to classify confidently
  if (maxScore >= 2) {
    if (transcriptScore === maxScore) return { type: "TRANSCRIPT", confidence: 0.8 };
    if (changeScore === maxScore) return { type: "CHANGE_ORDER", confidence: 0.8 };
    if (invoiceScore === maxScore) return { type: "INVOICE", confidence: 0.8 };
  }

  if (maxScore === 1) {
    if (transcriptScore === maxScore) return { type: "TRANSCRIPT", confidence: 0.5 };
    if (changeScore === maxScore) return { type: "CHANGE_ORDER", confidence: 0.5 };
    if (invoiceScore === maxScore) return { type: "INVOICE", confidence: 0.5 };
  }

  return { type: "UNKNOWN", confidence: 0 };
}

// ─── AI-powered classification fallback ──────────────────────

const ClassificationSchema = z.object({
  contentType: z.enum(["TRANSCRIPT", "CHANGE_ORDER", "INVOICE", "EMAIL_THREAD", "UNKNOWN"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export async function classifyWithAI(
  subject: string,
  bodyText: string,
  attachmentNames: string[] = [],
): Promise<{ type: InboundContentType; confidence: number; reasoning: string }> {
  const prompt = `You are a content classifier for a biopharma contract management system. Classify the following email content.

Subject: ${subject}
Body (first 2000 chars): ${bodyText.slice(0, 2000)}
${attachmentNames.length > 0 ? `Attachments: ${attachmentNames.join(", ")}` : "No attachments"}

Classify as one of:
- TRANSCRIPT: Meeting notes, transcripts, minutes, call recaps, Teams/Zoom meeting summaries
- CHANGE_ORDER: Change orders, contract amendments, scope modifications, formal change requests
- INVOICE: Invoices, billing statements, payment requests
- EMAIL_THREAD: General email discussion that may contain scope-relevant information
- UNKNOWN: Cannot determine content type

Return ONLY valid JSON:
{
  "contentType": "TRANSCRIPT",
  "confidence": 0.85,
  "reasoning": "Contains meeting notes header and action items"
}`;

  const { data } = await callClaudeWithSchema(prompt, ClassificationSchema);
  return {
    type: data.contentType,
    confidence: data.confidence,
    reasoning: data.reasoning,
  };
}

// ─── Combined classifier ─────────────────────────────────────

export async function classifyInboundContent(
  subject: string,
  bodyText: string,
  attachmentNames: string[] = [],
): Promise<{ type: InboundContentType; confidence: number }> {
  // Try keyword-based first
  const keywordResult = classifyByKeywords(subject, bodyText);

  // If confident enough, use keyword result
  if (keywordResult.confidence >= 0.8) {
    return keywordResult;
  }

  // Fall back to AI classification
  try {
    const aiResult = await classifyWithAI(subject, bodyText, attachmentNames);
    return { type: aiResult.type, confidence: aiResult.confidence };
  } catch {
    // If AI fails, use whatever keyword result we have (or UNKNOWN)
    return keywordResult.confidence > 0 ? keywordResult : { type: "UNKNOWN", confidence: 0 };
  }
}

// ─── Map content type to extraction target type ──────────────

export function mapToExtractionTarget(
  contentType: InboundContentType,
): string | null {
  switch (contentType) {
    case "TRANSCRIPT":
      return "CHANGE_TRANSCRIPT";
    case "CHANGE_ORDER":
      return "CHANGE_ORDER";
    case "INVOICE":
      return "INVOICE";
    case "EMAIL_THREAD":
      return "CHANGE_EMAIL";
    default:
      return null;
  }
}
