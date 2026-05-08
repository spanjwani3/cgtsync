/**
 * Inbound email processing service — handles emails received via
 * Postmark Inbound webhook, classifies content, stores evidence,
 * routes to the appropriate extraction pipeline, and (for transcripts)
 * runs scope-analysis inline so /scope populates without manual upload.
 */

import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/server/event-log";
import { classifyInboundContent, mapToExtractionTarget } from "@/lib/server/ingest-classifier";
import type { InboundContentType } from "@/lib/server/ingest-classifier";
import { analyzeScopeFromText } from "@/lib/server/scope-analysis";
import {
  extractTextForScope,
  isScopeEligibleMime,
} from "@/lib/server/extract-text-for-scope";

// ─── Ingest address generation ───────────────────────────────

export function generateIngestAddress(programId: string): string {
  const shortId = programId.replace(/-/g, "").slice(0, 8);
  // Default to inbox.cgtsync.ai (DNS-configured for Postmark inbound).
  // Override via INGEST_EMAIL_DOMAIN if a different MX setup is in use.
  const domain = process.env.INGEST_EMAIL_DOMAIN ?? "inbox.cgtsync.ai";
  return `prg-${shortId}@${domain}`;
}

// ─── Process inbound email ───────────────────────────────────

export interface ProcessResult {
  inboundEmailId: string;
  status: string;
  detectedType: InboundContentType;
  evidenceId?: string;
  extractionJobId?: string;
}

type AttachmentEvidence = {
  id: string;
  fileName: string;
  mimeType: string;
  storagePath: string;
};

/**
 * For each scope-eligible attachment Evidence row, extract its text and
 * run scope analysis. Failures per attachment are logged as recoverable
 * INGEST_EMAIL_FAILED events but do not abort the rest of the loop or
 * the parent inbound-email pipeline.
 */
async function runAttachmentScopeAnalysis(
  programId: string,
  inboundEmailId: string,
  attachments: AttachmentEvidence[],
): Promise<void> {
  for (const att of attachments) {
    if (!isScopeEligibleMime(att.mimeType)) continue;
    try {
      const text = await extractTextForScope(att.storagePath, att.mimeType);
      if (text.trim().length === 0) continue;
      const result = await analyzeScopeFromText(
        programId,
        text,
        "EMAIL_INGEST_ATTACHMENT",
        att.id,
      );
      await logEvent({
        programId,
        action: "SCOPE_ANALYSIS_COMPLETED",
        entityType: "ScopeAnalysis",
        entityId: result.analysisId,
        metadata: {
          inboundEmailId,
          evidenceId: att.id,
          attachmentName: att.fileName,
          alertCount: result.alertCount,
          source: "EMAIL_INGEST_ATTACHMENT",
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "attachment scope analysis failed";
      await logEvent({
        programId,
        action: "INGEST_EMAIL_FAILED",
        entityType: "InboundEmail",
        entityId: inboundEmailId,
        metadata: {
          stage: "attachment_scope_analysis",
          error: msg,
          evidenceId: att.id,
          attachmentName: att.fileName,
          recoverable:
            msg.startsWith("UNSUPPORTED_MIME") || msg === "NO_LOCKED_BASELINE",
        },
      });
    }
  }
}

export async function processInboundEmail(
  inboundEmailId: string,
): Promise<ProcessResult> {
  const email = await prisma.inboundEmail.findUniqueOrThrow({
    where: { id: inboundEmailId },
    include: { ingestAddress: true },
  });

  const programId = email.programId;

  try {
    // Update status to PROCESSING
    await prisma.inboundEmail.update({
      where: { id: inboundEmailId },
      data: { status: "PROCESSING" },
    });

    // Attachments were already created as Evidence rows by the inbound
    // webhook and tagged with metadata.inboundEmailId. Pull them now so
    // (a) we can hint the classifier with their filenames and (b) we can
    // run scope analysis on each one even if the body alone is unclassifiable.
    const attachmentEvidence = await prisma.evidence.findMany({
      where: {
        programId,
        AND: [
          { metadata: { path: ["source"], equals: "EMAIL_INGEST" } },
          { metadata: { path: ["inboundEmailId"], equals: inboundEmailId } },
        ],
      },
    });

    // Classify the content (filenames help when the body is just "see attached")
    const { type: detectedType, confidence } = await classifyInboundContent(
      email.subject ?? "",
      email.textBody ?? "",
      attachmentEvidence.map((a) => a.fileName),
    );

    // Update detected type
    await prisma.inboundEmail.update({
      where: { id: inboundEmailId },
      data: { detectedType },
    });

    // Run scope analysis on supported attachments regardless of body
    // classification — a "FYI see attached" cover email with a signed
    // change-order PDF should still produce ScopeAlerts even though the
    // body itself is UNKNOWN.
    await runAttachmentScopeAnalysis(programId, inboundEmailId, attachmentEvidence);

    // If body is UNKNOWN or low confidence, mark as NEEDS_REVIEW for the
    // body's purposes. Attachments were already processed above.
    if (detectedType === "UNKNOWN" || confidence < 0.5) {
      await prisma.inboundEmail.update({
        where: { id: inboundEmailId },
        data: { status: "NEEDS_REVIEW", processedAt: new Date() },
      });

      await logEvent({
        programId,
        action: "INGEST_EMAIL_RECEIVED",
        entityType: "InboundEmail",
        entityId: inboundEmailId,
        metadata: {
          detectedType,
          confidence,
          status: "NEEDS_REVIEW",
          attachmentCount: attachmentEvidence.length,
        },
      });

      return { inboundEmailId, status: "NEEDS_REVIEW", detectedType };
    }

    // Store email body as evidence
    const { uploadEvidence } = await import("@/lib/server/storage");
    const bodyContent = email.textBody ?? "";
    const fileName = `inbound-${email.subject?.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50) ?? "email"}.txt`;
    const buffer = Buffer.from(bodyContent, "utf-8");

    const storagePath = `${programId}/ingest/${Date.now()}-${fileName}`;
    const uploaded = await uploadEvidence(buffer, storagePath, "text/plain");
    const sha256Hash = uploaded.sha256Hash;

    // Map content type to evidence type
    const evidenceTypeMap: Record<string, string> = {
      TRANSCRIPT: "TRANSCRIPT",
      CHANGE_ORDER: "CHANGE_ORDER",
      INVOICE: "INVOICE",
      EMAIL_THREAD: "EMAIL_APPROVAL",
    };

    const evidence = await prisma.evidence.create({
      data: {
        programId,
        type: (evidenceTypeMap[detectedType] ?? "OTHER") as "TRANSCRIPT" | "CHANGE_ORDER" | "INVOICE" | "EMAIL_APPROVAL" | "OTHER",
        fileName,
        fileSize: uploaded.fileSize,
        mimeType: "text/plain",
        storagePath: uploaded.storagePath,
        sha256Hash,
        metadata: {
          source: "EMAIL_INGEST",
          fromEmail: email.fromEmail,
          fromName: email.fromName,
          subject: email.subject,
          inboundEmailId,
        },
      },
    });

    await logEvent({
      programId,
      action: "EVIDENCE_UPLOADED",
      entityType: "Evidence",
      entityId: evidence.id,
      metadata: { source: "EMAIL_INGEST", inboundEmailId },
    });

    // Create extraction job if we have a target type
    const targetType = mapToExtractionTarget(detectedType);
    let extractionJobId: string | undefined;

    if (targetType) {
      const job = await prisma.extractionJob.create({
        data: {
          evidenceId: evidence.id,
          programId,
          targetType: targetType as "CHANGE_TRANSCRIPT" | "CHANGE_ORDER" | "INVOICE" | "CHANGE_EMAIL",
          status: "PENDING",
        },
      });
      extractionJobId = job.id;

      await logEvent({
        programId,
        action: "EXTRACTION_JOB_CREATED",
        entityType: "ExtractionJob",
        entityId: job.id,
        metadata: { targetType, source: "EMAIL_INGEST", inboundEmailId },
      });
    }

    // Update inbound email as ROUTED
    await prisma.inboundEmail.update({
      where: { id: inboundEmailId },
      data: {
        status: "ROUTED",
        evidenceId: evidence.id,
        extractionJobId: extractionJobId ?? null,
        processedAt: new Date(),
      },
    });

    await logEvent({
      programId,
      action: "INGEST_EMAIL_PROCESSED",
      entityType: "InboundEmail",
      entityId: inboundEmailId,
      metadata: { detectedType, evidenceId: evidence.id, extractionJobId: extractionJobId ?? null },
    });

    const SCOPE_RELEVANT_TYPES: InboundContentType[] = ["TRANSCRIPT", "EMAIL_THREAD"];
    if (SCOPE_RELEVANT_TYPES.includes(detectedType) && bodyContent.trim().length > 0) {
      try {
        const result = await analyzeScopeFromText(
          programId,
          bodyContent,
          "EMAIL_INGEST",
          evidence.id,
        );
        await logEvent({
          programId,
          action: "SCOPE_ANALYSIS_COMPLETED",
          entityType: "ScopeAnalysis",
          entityId: result.analysisId,
          metadata: {
            inboundEmailId,
            evidenceId: evidence.id,
            alertCount: result.alertCount,
            source: "EMAIL_INGEST",
          },
        });
      } catch (analysisError) {
        const msg =
          analysisError instanceof Error
            ? analysisError.message
            : "scope analysis failed";
        // NO_LOCKED_BASELINE is the expected failure when the program has no
        // locked baseline yet. Don't fail the inbound webhook for this — the
        // transcript is still saved as Evidence and can be re-analyzed later.
        await logEvent({
          programId,
          action: "INGEST_EMAIL_FAILED",
          entityType: "InboundEmail",
          entityId: inboundEmailId,
          metadata: {
            stage: "scope_analysis",
            error: msg,
            inboundEmailId,
            evidenceId: evidence.id,
            recoverable: msg === "NO_LOCKED_BASELINE",
          },
        });
      }
    }

    return {
      inboundEmailId,
      status: "ROUTED",
      detectedType,
      evidenceId: evidence.id,
      extractionJobId,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";

    await prisma.inboundEmail.update({
      where: { id: inboundEmailId },
      data: { status: "FAILED", errorMessage: errMsg, processedAt: new Date() },
    });

    await logEvent({
      programId,
      action: "INGEST_EMAIL_FAILED",
      entityType: "InboundEmail",
      entityId: inboundEmailId,
      metadata: { error: errMsg },
    });

    throw error;
  }
}

// ─── Reclassify and reprocess ────────────────────────────────

export async function reclassifyInboundEmail(
  inboundEmailId: string,
  newType: InboundContentType,
): Promise<ProcessResult> {
  await prisma.inboundEmail.update({
    where: { id: inboundEmailId },
    data: {
      detectedType: newType,
      status: "RECEIVED",
      errorMessage: null,
    },
  });

  return processInboundEmail(inboundEmailId);
}
