/**
 * Scope analysis service — compares transcript-extracted candidate changes
 * against the locked baseline and confirmed change orders to detect scope creep.
 *
 * Two-step process:
 * 1. Extract candidate changes from transcript text (reuses CHANGE_TRANSCRIPT extraction)
 * 2. Compare each candidate against baseline clauses + confirmed changes
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { callClaudeWithSchema } from "@/lib/server/extraction";
import { logEvent } from "@/lib/server/event-log";
import { Prisma } from "@/generated/prisma/client";

// ─── Zod schemas for AI responses ────────────────────────────

const TranscriptParseSchema = z.object({
  meetingTitle: z.string().nullable().optional(),
  meetingDate: z.string().nullable().optional(),
  participants: z.array(z.string()).optional().default([]),
  candidates: z.array(
    z.object({
      changeTitle: z.string().min(1),
      description: z.string().nullable().optional(),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).catch("MEDIUM"),
      estimatedImpact: z.number().nullable().optional(),
      scheduleImpactDays: z.number().int().nullable().optional(),
      speaker: z.string().nullable().optional(),
      excerpt: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
  summary: z.string().nullable().optional(),
});

const ScopeComparisonSchema = z.object({
  results: z.array(
    z.object({
      candidateIndex: z.number().int().min(0),
      matchType: z.enum(["COVERED", "PARTIAL_MATCH", "NO_COVERAGE"]),
      matchedClauseId: z.string().nullable(),
      matchedChangeId: z.string().nullable(),
      matchSummary: z.string(),
      confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
      recommendedAction: z.enum([
        "INITIATE_CHANGE_ORDER",
        "CLARIFY_WITH_SPONSOR",
        "NO_ACTION",
        "REVIEW",
      ]),
    }),
  ),
  overallSummary: z.string(),
});

type ScopeComparison = z.infer<typeof ScopeComparisonSchema>;

// ─── Prompt builders ─────────────────────────────────────────

const TRANSCRIPT_PARSE_PROMPT = `You are an expert at analyzing meeting transcripts and notes for biopharma outsourcing programs. Your job is to find ALL potential scope changes, cost impacts, and action items that could affect the contract.

Scan the transcript for phrases like:
- "action item", "agreed to", "we decided", "let's add", "need to change"
- Cost mentions: dollar amounts, budget discussions, "additional cost", "extra charge"
- Schedule impacts: "delay", "push back", "ahead of schedule", "extra days/weeks"
- Risk items: "risk", "concern", "issue", "problem"
- Scope changes: "out of scope", "scope creep", "additional work", "not in the SOW"

For EACH potential change, extract:
- changeTitle: Brief title
- description: What was discussed/agreed
- severity: LOW, MEDIUM, HIGH, or CRITICAL
- estimatedImpact: Dollar amount if mentioned, or null
- scheduleImpactDays: Number of days impact if mentioned, or null
- speaker: Who proposed or mentioned this change
- excerpt: Verbatim quote (10-40 words)
- confidence: 0.0 to 1.0

Be thorough — extract ALL potential scope changes, even uncertain ones. Use lower confidence for uncertain items.

Return ONLY valid JSON:
{
  "meetingTitle": "Meeting title or null",
  "meetingDate": "YYYY-MM-DD or null",
  "participants": ["Name 1", "Name 2"],
  "candidates": [...],
  "summary": "Brief summary"
}`;

function buildScopeComparisonPrompt(
  candidates: Array<{ index: number; title: string; description: string | null; excerpt: string }>,
  clauses: Array<{ id: string; clauseRef: string | null; type: string; title: string; description: string | null; value: number | null; unit: string | null }>,
  changes: Array<{ id: string; sequenceNum: number; title: string; description: string | null; estimatedImpact: number | null; status: string }>,
): string {
  const candidatesBlock = candidates
    .map(
      (c) =>
        `[${c.index}] "${c.title}" — ${c.description ?? "No description"}. Excerpt: "${c.excerpt}"`,
    )
    .join("\n");

  const clausesBlock =
    clauses.length > 0
      ? clauses
          .map(
            (c) =>
              `- ID:${c.id} Ref:${c.clauseRef ?? "N/A"} "${c.title}" — ${c.description ?? "N/A"} (Value: ${c.value ?? "N/A"} ${c.unit ?? ""}, Type: ${c.type})`,
          )
          .join("\n")
      : "(No baseline clauses)";

  const changesBlock =
    changes.length > 0
      ? changes
          .map(
            (c) =>
              `- ID:${c.id} CO-${c.sequenceNum} "${c.title}" — ${c.description ?? "N/A"} (Impact: ${c.estimatedImpact ?? "N/A"}, Status: ${c.status})`,
          )
          .join("\n")
      : "(No confirmed change orders)";

  return `You are an expert contract scope analyst for biopharma outsourcing. Your task is to determine whether potential changes identified in a meeting transcript fall within or outside the current contractual scope.

CANDIDATE CHANGES (from transcript):
${candidatesBlock}

BASELINE CLAUSES (from locked SOW):
${clausesBlock}

CONFIRMED CHANGE ORDERS:
${changesBlock}

INSTRUCTIONS:
For each candidate change, determine:
1. matchType:
   - "COVERED" if the work is clearly within an existing baseline clause or confirmed change order
   - "PARTIAL_MATCH" if there's a related clause but the candidate extends beyond it or modifies it
   - "NO_COVERAGE" if no baseline clause or change order covers this work
2. matchedClauseId: The ID of the best-matching baseline clause (or null)
3. matchedChangeId: The ID of the best-matching change order (or null)
4. matchSummary: Brief explanation of why it matches or doesn't
5. confidence: HIGH (clear match/mismatch), MEDIUM (plausible but ambiguous), LOW (uncertain)
6. recommendedAction:
   - "NO_ACTION" if clearly covered
   - "REVIEW" if partially covered but may need attention
   - "CLARIFY_WITH_SPONSOR" if ambiguous and needs sponsor input
   - "INITIATE_CHANGE_ORDER" if clearly out of scope and needs a formal CO

Return ONLY valid JSON:
{
  "results": [
    {
      "candidateIndex": 0,
      "matchType": "NO_COVERAGE",
      "matchedClauseId": null,
      "matchedChangeId": null,
      "matchSummary": "No SOW coverage found for nitrogen overlay system",
      "confidence": "HIGH",
      "recommendedAction": "INITIATE_CHANGE_ORDER"
    }
  ],
  "overallSummary": "3 of 5 candidates have no SOW coverage and require change orders"
}`;
}

// ─── Main analysis function ──────────────────────────────────

export interface ScopeAnalysisResult {
  analysisId: string;
  alertCount: number;
  summary: string;
  alerts: Array<{
    id: string;
    title: string;
    description: string | null;
    matchSummary: string | null;
    confidence: string;
    recommendedAction: string;
    severity: string;
    status: string;
  }>;
}

export async function analyzeScopeFromText(
  programId: string,
  text: string,
  source: string = "UPLOAD",
  evidenceId?: string,
  userId?: string,
): Promise<ScopeAnalysisResult> {
  // 1. Fetch the latest locked/confirmed baseline
  const latestBaseline = await prisma.baseline.findFirst({
    where: { programId, status: { in: ["LOCKED", "CONFIRMED"] } },
    orderBy: { version: "desc" },
    include: { clauses: { orderBy: { sortOrder: "asc" } } },
  });

  if (!latestBaseline) {
    throw new Error("NO_LOCKED_BASELINE");
  }

  // Create the ScopeAnalysis record
  const analysis = await prisma.scopeAnalysis.create({
    data: {
      programId,
      evidenceId: evidenceId ?? null,
      baselineId: latestBaseline.id,
      source,
      status: "PROCESSING",
    },
  });

  await logEvent({
    programId,
    userId,
    action: "SCOPE_ANALYSIS_STARTED",
    entityType: "ScopeAnalysis",
    entityId: analysis.id,
  });

  try {
    // 2. Extract candidates from transcript text
    const transcriptPrompt = `${TRANSCRIPT_PARSE_PROMPT}\n\nTRANSCRIPT:\n${text}`;
    const { data: transcriptData, tokensUsed: parseTokens } = await callClaudeWithSchema(
      transcriptPrompt,
      TranscriptParseSchema,
    );

    if (transcriptData.candidates.length === 0) {
      // No candidates found — mark as complete with 0 alerts
      await prisma.scopeAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: "COMPLETED",
          meetingTitle: transcriptData.meetingTitle ?? null,
          meetingDate: transcriptData.meetingDate ? new Date(transcriptData.meetingDate) : null,
          participants: transcriptData.participants as unknown as Prisma.InputJsonValue,
          summary: transcriptData.summary ?? "No potential scope changes detected.",
          alertCount: 0,
          tokensUsed: parseTokens,
        },
      });

      await logEvent({
        programId,
        userId,
        action: "SCOPE_ANALYSIS_COMPLETED",
        entityType: "ScopeAnalysis",
        entityId: analysis.id,
        metadata: { alertCount: 0, tokensUsed: parseTokens },
      });

      return {
        analysisId: analysis.id,
        alertCount: 0,
        summary: "No potential scope changes detected in transcript.",
        alerts: [],
      };
    }

    // 3. Fetch confirmed changes for comparison
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

    // 4. Build inputs for scope comparison
    const clauseInputs = latestBaseline.clauses.map((c) => ({
      id: c.id,
      clauseRef: c.clauseRef,
      type: c.type,
      title: c.title,
      description: c.description,
      value: c.value ? Number(c.value) : null,
      unit: c.unit,
    }));

    const changeInputs = confirmedChanges.map((c) => ({
      id: c.id,
      sequenceNum: c.sequenceNum,
      title: c.title,
      description: c.description,
      estimatedImpact: c.estimatedImpact ? Number(c.estimatedImpact) : null,
      status: c.status,
    }));

    const candidateInputs = transcriptData.candidates.map((c, i) => ({
      index: i,
      title: c.changeTitle,
      description: c.description ?? null,
      excerpt: c.excerpt,
    }));

    // 5. Run scope comparison via Claude
    const comparisonPrompt = buildScopeComparisonPrompt(
      candidateInputs,
      clauseInputs,
      changeInputs,
    );
    const { data: comparison, tokensUsed: compareTokens } =
      await callClaudeWithSchema<ScopeComparison>(comparisonPrompt, ScopeComparisonSchema);

    const totalTokens = parseTokens + compareTokens;

    // 6. Create ScopeAlert records for non-covered items
    const clauseMap = new Map(clauseInputs.map((c) => [c.id, c]));
    const changeMap = new Map(changeInputs.map((c) => [c.id, c]));

    const alertsToCreate: Array<{
      title: string;
      description: string | null;
      transcriptExcerpt: string;
      matchedClauseId: string | null;
      matchSummary: string;
      confidence: string;
      recommendedAction: string;
      severity: string;
      estimatedImpact: number | null;
      scheduleImpactDays: number | null;
      speaker: string | null;
    }> = [];

    for (const result of comparison.results) {
      const candidate = transcriptData.candidates[result.candidateIndex];
      if (!candidate) continue;

      // Only create alerts for items that are NOT fully covered
      if (result.matchType === "COVERED" && result.confidence === "HIGH") continue;

      // Validate matchedClauseId if provided
      const validClauseId =
        result.matchedClauseId && clauseMap.has(result.matchedClauseId)
          ? result.matchedClauseId
          : null;

      alertsToCreate.push({
        title: candidate.changeTitle,
        description: candidate.description ?? null,
        transcriptExcerpt: candidate.excerpt,
        matchedClauseId: validClauseId,
        matchSummary: result.matchSummary,
        confidence: result.confidence,
        recommendedAction: result.recommendedAction,
        severity: candidate.severity,
        estimatedImpact: candidate.estimatedImpact ?? null,
        scheduleImpactDays: candidate.scheduleImpactDays ?? null,
        speaker: candidate.speaker ?? null,
      });
    }

    // Batch create alerts
    const createdAlerts = [];
    for (const alertData of alertsToCreate) {
      const alert = await prisma.scopeAlert.create({
        data: {
          programId,
          analysisJobId: analysis.id,
          title: alertData.title,
          description: alertData.description,
          transcriptExcerpt: alertData.transcriptExcerpt,
          matchedClauseId: alertData.matchedClauseId,
          matchSummary: alertData.matchSummary,
          confidence: alertData.confidence,
          recommendedAction: alertData.recommendedAction,
          severity: alertData.severity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
          estimatedImpact: alertData.estimatedImpact,
          scheduleImpactDays: alertData.scheduleImpactDays,
          speaker: alertData.speaker,
        },
      });
      createdAlerts.push(alert);

      await logEvent({
        programId,
        userId,
        action: "SCOPE_ALERT_CREATED",
        entityType: "ScopeAlert",
        entityId: alert.id,
        metadata: {
          title: alertData.title,
          confidence: alertData.confidence,
          recommendedAction: alertData.recommendedAction,
        },
      });
    }

    // 7. Update the analysis record
    await prisma.scopeAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "COMPLETED",
        meetingTitle: transcriptData.meetingTitle ?? null,
        meetingDate: transcriptData.meetingDate ? new Date(transcriptData.meetingDate) : null,
        participants: transcriptData.participants as unknown as Prisma.InputJsonValue,
        summary: comparison.overallSummary,
        alertCount: createdAlerts.length,
        tokensUsed: totalTokens,
      },
    });

    await logEvent({
      programId,
      userId,
      action: "SCOPE_ANALYSIS_COMPLETED",
      entityType: "ScopeAnalysis",
      entityId: analysis.id,
      metadata: {
        alertCount: createdAlerts.length,
        candidateCount: transcriptData.candidates.length,
        tokensUsed: totalTokens,
      },
    });

    return {
      analysisId: analysis.id,
      alertCount: createdAlerts.length,
      summary: comparison.overallSummary,
      alerts: createdAlerts.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        matchSummary: a.matchSummary,
        confidence: a.confidence,
        recommendedAction: a.recommendedAction,
        severity: a.severity,
        status: a.status,
      })),
    };
  } catch (error) {
    // Mark analysis as failed
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    await prisma.scopeAnalysis.update({
      where: { id: analysis.id },
      data: { status: "FAILED", errorMessage: errMsg },
    });
    throw error;
  }
}

// ─── Alert resolution ────────────────────────────────────────

export async function resolveAlert(
  alertId: string,
  action: "DISMISS" | "CONVERT_TO_CHANGE",
  userId?: string,
  resolvedNote?: string,
): Promise<{ alert: { id: string; status: string }; changeId?: string }> {
  const alert = await prisma.scopeAlert.findUniqueOrThrow({
    where: { id: alertId },
    include: { program: true },
  });

  if (alert.status !== "OPEN") {
    throw new Error("ALERT_ALREADY_RESOLVED");
  }

  if (action === "DISMISS") {
    const updated = await prisma.scopeAlert.update({
      where: { id: alertId },
      data: {
        status: "DISMISSED",
        resolvedAt: new Date(),
        resolvedNote: resolvedNote ?? null,
      },
    });

    await logEvent({
      programId: alert.programId,
      userId,
      action: "SCOPE_ALERT_RESOLVED",
      entityType: "ScopeAlert",
      entityId: alertId,
      metadata: { resolution: "DISMISSED", resolvedNote: resolvedNote ?? null },
    });

    return { alert: { id: updated.id, status: updated.status } };
  }

  // CONVERT_TO_CHANGE: Create a draft Change from alert data
  const maxSeq = await prisma.change.aggregate({
    where: { programId: alert.programId },
    _max: { sequenceNum: true },
  });
  const nextSeq = (maxSeq._max.sequenceNum ?? 0) + 1;

  const change = await prisma.change.create({
    data: {
      programId: alert.programId,
      sequenceNum: nextSeq,
      title: alert.title,
      description: alert.description
        ? `${alert.description}\n\n---\nSource: Scope alert from transcript analysis\nExcerpt: "${alert.transcriptExcerpt}"`
        : `Source: Scope alert from transcript analysis\nExcerpt: "${alert.transcriptExcerpt}"`,
      severity: alert.severity,
      estimatedImpact: alert.estimatedImpact,
      scheduleImpactDays: alert.scheduleImpactDays,
      status: "DRAFT",
    },
  });

  await prisma.scopeAlert.update({
    where: { id: alertId },
    data: {
      status: "CONVERTED",
      resolvedAt: new Date(),
      convertedChangeId: change.id,
      resolvedNote: resolvedNote ?? null,
    },
  });

  await logEvent({
    programId: alert.programId,
    userId,
    action: "SCOPE_ALERT_CONVERTED",
    entityType: "ScopeAlert",
    entityId: alertId,
    metadata: { changeId: change.id, sequenceNum: nextSeq },
  });

  await logEvent({
    programId: alert.programId,
    userId,
    action: "CHANGE_DRAFTED",
    entityType: "Change",
    entityId: change.id,
    metadata: { fromScopeAlert: alertId, auto: true },
  });

  return { alert: { id: alertId, status: "CONVERTED" }, changeId: change.id };
}
