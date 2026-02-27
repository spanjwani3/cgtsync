/**
 * Invoice reconciliation engine — uses Claude to fuzzy-match invoice line items
 * against baseline clauses and confirmed change orders, then runs deterministic
 * flag detection (RATE_MISMATCH, SCOPE_CREEP, UNAPPROVED_CHANGE).
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { callClaudeWithSchema } from "@/lib/server/extraction";
import { logEvent } from "@/lib/server/event-log";

// ─── Zod schema for Claude's reconciliation response ─────────

const ReconciliationMapping = z.object({
  lineItemIndex: z.number().int().min(0),
  matchType: z.enum(["CLAUSE", "CHANGE", "UNMAPPED"]),
  matchId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  flagSuggestion: z
    .enum(["NONE", "RATE_MISMATCH", "SCOPE_CREEP", "UNAPPROVED_CHANGE", "MISSING_BASELINE"])
    .nullable(),
  flagNote: z.string().nullable(),
  reasoning: z.string(),
});

const ReconciliationSchema = z.object({
  mappings: z.array(ReconciliationMapping),
  summary: z.string(),
});

type ReconciliationData = z.infer<typeof ReconciliationSchema>;

// ─── Prompt builder ──────────────────────────────────────────

interface LineItemInput {
  index: number;
  description: string;
  amount: number;
  quantity?: number | null;
  unitPrice?: number | null;
}

interface ClauseInput {
  id: string;
  clauseRef: string | null;
  title: string;
  description: string | null;
  value: number | null;
  unit: string | null;
  type: string;
}

interface ChangeInput {
  id: string;
  sequenceNum: number;
  title: string;
  description: string | null;
  estimatedImpact: number | null;
  status: string;
}

function buildReconciliationPrompt(
  lineItems: LineItemInput[],
  clauses: ClauseInput[],
  changes: ChangeInput[],
): string {
  const lineItemsBlock = lineItems
    .map(
      (li) =>
        `[${li.index}] "${li.description}" — Amount: ${li.amount}${li.unitPrice != null ? `, Unit Price: ${li.unitPrice}` : ""}${li.quantity != null ? `, Qty: ${li.quantity}` : ""}`,
    )
    .join("\n");

  const clausesBlock =
    clauses.length > 0
      ? clauses
          .map(
            (c) =>
              `- ID:${c.id} Ref:${c.clauseRef ?? "N/A"} "${c.title}" — Value: ${c.value ?? "N/A"} ${c.unit ?? ""} (Type: ${c.type})`,
          )
          .join("\n")
      : "(No locked baseline clauses found — lock a baseline before reconciling invoices)";

  const changesBlock =
    changes.length > 0
      ? changes
          .map(
            (c) =>
              `- ID:${c.id} #${c.sequenceNum} "${c.title}" — Impact: ${c.estimatedImpact ?? "N/A"} (Status: ${c.status})`,
          )
          .join("\n")
      : "(No confirmed change orders)";

  return `You are an expert contract reconciliation analyst for biopharma outsourcing.
Your task is to map invoice line items to their corresponding truth sources (SOW baseline clauses or approved change orders).

INVOICE LINE ITEMS:
${lineItemsBlock}

BASELINE CLAUSES (from locked SOW):
${clausesBlock}

CONFIRMED CHANGE ORDERS:
${changesBlock}

INSTRUCTIONS:
1. For each invoice line item, find the BEST matching baseline clause or change order based on semantic similarity of descriptions/titles.
2. Use fuzzy matching — abbreviations, synonyms, and partial matches count (e.g., "Stab Study" matches "Stability Study", "API Mfg" matches "API Manufacturing", "GMP Batch" matches "GMP Batch Manufacture").
3. If a line item clearly matches a baseline clause, set matchType to "CLAUSE" and matchId to the clause ID.
4. If a line item clearly matches a change order, set matchType to "CHANGE" and matchId to the change ID.
5. If NO reasonable match exists, set matchType to "UNMAPPED" and matchId to null.
6. Set confidence between 0.0 and 1.0:
   - 0.9-1.0: Near-exact description match
   - 0.7-0.89: Clear semantic match with minor wording differences
   - 0.5-0.69: Plausible match but ambiguous
   - Below 0.5: Set to UNMAPPED instead
7. For flagSuggestion:
   - "RATE_MISMATCH" if the invoice amount differs from the clause value by more than 5%
   - "SCOPE_CREEP" if unmapped (no matching clause or change)
   - "UNAPPROVED_CHANGE" if matched to a change that is not CONFIRMED or LOGGED
   - "NONE" if cleanly matched with acceptable variance
8. Provide brief reasoning for each mapping.

Return ONLY valid JSON with this structure:
{
  "mappings": [
    {
      "lineItemIndex": 0,
      "matchType": "CLAUSE",
      "matchId": "uuid-of-clause",
      "confidence": 0.92,
      "flagSuggestion": "NONE",
      "flagNote": null,
      "reasoning": "Invoice 'Stab Study' closely matches clause 'Stability Study'"
    }
  ],
  "summary": "8 of 10 items matched to baseline clauses, 1 matched to change order, 1 unmapped"
}

Return ONLY valid JSON, no markdown fences.`;
}

// ─── Main reconciliation function ────────────────────────────

export interface ReconciliationResult {
  stats: { matched: number; flagged: number; unmapped: number; total: number };
  summary: string;
  mappings: Array<{
    lineItemId: string;
    matchType: string;
    matchId: string | null;
    confidence: number;
    flag: string;
    flagNote: string | null;
    reasoning: string;
  }>;
}

export async function reconcileInvoice(
  invoiceId: string,
  programId: string,
  userId?: string,
): Promise<ReconciliationResult> {
  // 1. Fetch truth sources
  const latestBaseline = await prisma.baseline.findFirst({
    where: { programId, status: { in: ["LOCKED", "CONFIRMED"] } },
    orderBy: { version: "desc" },
    include: { clauses: { orderBy: { sortOrder: "asc" } } },
  });

  const confirmedChanges = await prisma.change.findMany({
    where: { programId, status: { in: ["CONFIRMED", "LOGGED"] } },
    orderBy: { sequenceNum: "asc" },
    select: {
      id: true,
      sequenceNum: true,
      title: true,
      description: true,
      estimatedImpact: true,
      status: true,
    },
  });

  // 2. Fetch invoice line items
  const lineItems = await prisma.invoiceLineItem.findMany({
    where: { invoiceId },
    orderBy: { sortOrder: "asc" },
  });

  if (lineItems.length === 0) {
    return { stats: { matched: 0, flagged: 0, unmapped: 0, total: 0 }, summary: "No line items to reconcile", mappings: [] };
  }

  // 3. Build clause and change input lists
  const clauseInputs: ClauseInput[] = (latestBaseline?.clauses ?? []).map((c) => ({
    id: c.id,
    clauseRef: c.clauseRef,
    title: c.title,
    description: c.description,
    value: c.value ? Number(c.value) : null,
    unit: c.unit,
    type: c.type,
  }));

  const changeInputs: ChangeInput[] = confirmedChanges.map((c) => ({
    id: c.id,
    sequenceNum: c.sequenceNum,
    title: c.title,
    description: c.description,
    estimatedImpact: c.estimatedImpact ? Number(c.estimatedImpact) : null,
    status: c.status,
  }));

  const lineItemInputs: LineItemInput[] = lineItems.map((li, i) => ({
    index: i,
    description: li.description,
    amount: Number(li.amount),
    quantity: li.quantity ? Number(li.quantity) : null,
    unitPrice: li.unitPrice ? Number(li.unitPrice) : null,
  }));

  // 4. If no truth sources exist, flag all as MISSING_BASELINE
  if (clauseInputs.length === 0 && changeInputs.length === 0) {
    for (const li of lineItems) {
      await prisma.invoiceLineItem.update({
        where: { id: li.id },
        data: { flag: "MISSING_BASELINE", flagNote: "No locked baseline or confirmed changes exist for this program", clauseId: null, changeId: null },
      });
    }
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: "FLAGGED" } });
    return {
      stats: { matched: 0, flagged: lineItems.length, unmapped: 0, total: lineItems.length },
      summary: "No baseline or confirmed changes found. All items flagged as MISSING_BASELINE.",
      mappings: lineItems.map((li) => ({
        lineItemId: li.id,
        matchType: "UNMAPPED",
        matchId: null,
        confidence: 0,
        flag: "MISSING_BASELINE",
        flagNote: "No locked baseline or confirmed changes exist for this program",
        reasoning: "No truth sources available",
      })),
    };
  }

  // 5. Call Claude for fuzzy matching
  const prompt = buildReconciliationPrompt(lineItemInputs, clauseInputs, changeInputs);
  const { data: reconciliation } = await callClaudeWithSchema<ReconciliationData>(prompt, ReconciliationSchema);

  // Build lookup maps for validation
  const clauseMap = new Map(clauseInputs.map((c) => [c.id, c]));
  const changeMap = new Map(changeInputs.map((c) => [c.id, c]));

  // 6. Apply mappings and run deterministic flag detection
  const results: ReconciliationResult["mappings"] = [];
  let matched = 0;
  let flagged = 0;
  let unmapped = 0;

  for (let i = 0; i < lineItems.length; i++) {
    const li = lineItems[i];
    const mapping = reconciliation.mappings.find((m) => m.lineItemIndex === i);

    let clauseId: string | null = null;
    let changeId: string | null = null;
    let flag = "NONE";
    let flagNote: string | null = null;
    let matchType = "UNMAPPED";
    let matchId: string | null = null;
    let confidence = 0;
    let reasoning = "No mapping from AI";

    if (mapping) {
      matchType = mapping.matchType;
      matchId = mapping.matchId;
      confidence = mapping.confidence;
      reasoning = mapping.reasoning;

      if (mapping.matchType === "CLAUSE" && mapping.matchId && clauseMap.has(mapping.matchId)) {
        clauseId = mapping.matchId;
      } else if (mapping.matchType === "CHANGE" && mapping.matchId && changeMap.has(mapping.matchId)) {
        changeId = mapping.matchId;
      } else {
        // Invalid matchId or UNMAPPED
        matchType = "UNMAPPED";
        matchId = null;
      }
    }

    // Deterministic flag detection (overrides Claude's suggestions)
    const lineAmount = Number(li.amount);

    if (clauseId) {
      const clause = clauseMap.get(clauseId);
      if (clause?.value != null && clause.value !== 0) {
        const diff = Math.abs(lineAmount - clause.value) / Math.abs(clause.value);
        if (diff > 0.05) {
          flag = "RATE_MISMATCH";
          const variance = lineAmount - clause.value;
          flagNote = `Line amount ${lineAmount.toLocaleString()} differs from clause value ${clause.value.toLocaleString()} by ${(diff * 100).toFixed(1)}% (${variance >= 0 ? "+" : ""}${variance.toLocaleString()})`;
        }
      }
      matched++;
    } else if (changeId) {
      // Check if the change is actually confirmed (should be, given our query, but double-check)
      const change = changeMap.get(changeId);
      if (change && change.status !== "CONFIRMED" && change.status !== "LOGGED") {
        flag = "UNAPPROVED_CHANGE";
        flagNote = `Mapped to Change #${change.sequenceNum} which is in ${change.status} status (not yet confirmed)`;
      }
      matched++;
    } else {
      // Unmapped
      flag = "SCOPE_CREEP";
      flagNote = "No matching baseline clause or confirmed change order found";
      unmapped++;
    }

    if (flag !== "NONE") flagged++;

    // Update the line item in the database
    await prisma.invoiceLineItem.update({
      where: { id: li.id },
      data: { clauseId, changeId, flag: flag as any, flagNote },
    });

    // Log individual flags
    if (flag !== "NONE") {
      await logEvent({
        programId,
        userId,
        action: "LINE_ITEM_FLAGGED",
        entityType: "InvoiceLineItem",
        entityId: li.id,
        metadata: { flag, flagNote: flagNote ?? "", invoiceId, confidence, matchType, auto: true },
      });
    }

    results.push({ lineItemId: li.id, matchType, matchId, confidence, flag, flagNote, reasoning });
  }

  // 7. Update invoice status
  const newStatus = flagged > 0 ? "FLAGGED" : "MAPPED";
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: newStatus } });

  // 8. Log reconciliation event
  await logEvent({
    programId,
    userId,
    action: "INVOICE_MAPPED",
    entityType: "Invoice",
    entityId: invoiceId,
    metadata: { matched, flagged, unmapped, total: lineItems.length, aiReconciled: true },
  });

  return {
    stats: { matched, flagged, unmapped, total: lineItems.length },
    summary: reconciliation.summary,
    mappings: results,
  };
}
