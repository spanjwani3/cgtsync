/**
 * Postmark Inbound webhook.
 *
 * Receives forwarded emails / cc'd correspondence on per-program addresses
 * (Program.inboundEmailAddress), stores body + attachments as Evidence, runs
 * extraction (CHANGE_TRANSCRIPT for forwarded notes, CHANGE_EMAIL otherwise),
 * and reconciles extracted candidates against the locked baseline so scope
 * creep surfaces in real time.
 *
 * Auth: HTTP basic auth. Postmark webhook URL must be of the form
 *   https://cgtsync:<INBOUND_EMAIL_WEBHOOK_SECRET>@<host>/api/gateway/inbound-email
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  EvidenceType,
  ExtractionTargetType,
  Prisma,
} from "@/generated/prisma/client";
import { uploadEvidence } from "@/lib/server/storage";
import { runExtraction } from "@/lib/server/extraction";
import {
  reconcileCandidateChanges,
  type CandidateInput,
} from "@/lib/server/reconciliation";
import { generateRequestId } from "@/lib/config";

interface PostmarkAddress {
  Name?: string;
  Email: string;
  MailboxHash?: string;
}

interface PostmarkAttachment {
  Name: string;
  Content: string; // base64
  ContentType: string;
  ContentLength: number;
}

interface PostmarkHeader {
  Name: string;
  Value: string;
}

interface PostmarkInbound {
  MessageID: string;
  From?: string;
  FromName?: string;
  FromFull?: PostmarkAddress;
  To?: string;
  ToFull?: PostmarkAddress[];
  Cc?: string;
  CcFull?: PostmarkAddress[];
  Bcc?: string;
  BccFull?: PostmarkAddress[];
  OriginalRecipient?: string;
  Subject?: string;
  Date?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Headers?: PostmarkHeader[];
  Attachments?: PostmarkAttachment[];
}

const TRANSCRIPT_SUBJECT_RE = /\b(transcript|meeting|notes|recording|minutes|sync|stand[- ]?up)\b/i;

function verifyBasicAuth(req: NextRequest): boolean {
  const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
    const [, password] = decoded.split(":", 2);
    return password === secret;
  } catch {
    return false;
  }
}

function collectRecipients(payload: PostmarkInbound): string[] {
  const out: string[] = [];
  for (const list of [payload.ToFull, payload.CcFull, payload.BccFull]) {
    if (!list) continue;
    for (const a of list) {
      if (a?.Email) out.push(a.Email.toLowerCase());
    }
  }
  if (payload.OriginalRecipient) out.push(payload.OriginalRecipient.toLowerCase());
  return Array.from(new Set(out));
}

interface AuthResults {
  spfPass: boolean;
  dkimPass: boolean;
  raw: string | null;
}

function parseAuthResults(headers: PostmarkHeader[] | undefined): AuthResults {
  const h = headers?.find((x) => x.Name.toLowerCase() === "authentication-results");
  if (!h) return { spfPass: false, dkimPass: false, raw: null };
  const v = h.Value.toLowerCase();
  return {
    spfPass: /spf\s*=\s*pass/.test(v),
    dkimPass: /dkim\s*=\s*pass/.test(v),
    raw: h.Value,
  };
}

function senderDomain(payload: PostmarkInbound): string | null {
  const email = payload.FromFull?.Email ?? payload.From;
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

function classify(payload: PostmarkInbound): {
  evidenceType: EvidenceType;
  target: ExtractionTargetType;
} {
  const subject = payload.Subject ?? "";
  if (TRANSCRIPT_SUBJECT_RE.test(subject)) {
    return { evidenceType: "TRANSCRIPT", target: "CHANGE_TRANSCRIPT" };
  }
  return { evidenceType: "EMAIL_APPROVAL", target: "CHANGE_EMAIL" };
}

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200) || "attachment";
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();

  if (!verifyBasicAuth(req)) {
    return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
  }

  let payload: PostmarkInbound;
  try {
    payload = (await req.json()) as PostmarkInbound;
  } catch {
    await prisma.eventLog.create({
      data: {
        action: "EVIDENCE_UPLOADED",
        entityType: "InboundEmail",
        metadata: {
          source: "postmark_inbound",
          dropped: true,
          reason: "invalid_json",
        } as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ requestId, ok: true, dropped: "invalid_json" });
  }

  if (!payload.MessageID) {
    return NextResponse.json({ requestId, ok: true, dropped: "missing_message_id" });
  }

  // Idempotency: if we've already ingested this MessageID, no-op.
  const dup = await prisma.evidence.findUnique({
    where: { inboundMessageId: payload.MessageID },
  });
  if (dup) {
    return NextResponse.json({
      requestId,
      ok: true,
      duplicate: true,
      evidenceId: dup.id,
    });
  }

  const recipients = collectRecipients(payload);

  // Resolve to a program via either path:
  //   1. IngestAddress table (canonical, multi-address per program, used by /scope UI)
  //   2. Program.inboundEmailAddress (legacy single-field, set during onboarding)
  // IngestAddress is checked first because it carries the scope-analysis pipeline.
  const ingestAddress = recipients.length
    ? await prisma.ingestAddress.findFirst({
        where: { address: { in: recipients }, isActive: true },
        include: { program: true },
      })
    : null;

  const program =
    ingestAddress?.program ??
    (recipients.length
      ? await prisma.program.findFirst({
          where: { inboundEmailAddress: { in: recipients } },
        })
      : null);

  if (!program) {
    await prisma.eventLog.create({
      data: {
        action: "EVIDENCE_UPLOADED",
        entityType: "InboundEmail",
        metadata: {
          source: "postmark_inbound",
          dropped: true,
          reason: "no_matching_program",
          messageId: payload.MessageID,
          from: payload.From ?? null,
          subject: payload.Subject ?? null,
          recipients,
        } as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ requestId, ok: true, dropped: "no_matching_program" });
  }

  // If we matched via an IngestAddress row, route through the scope-analysis
  // pipeline so the email surfaces as ScopeAlerts on /scope. The fallback path
  // (Program.inboundEmailAddress) keeps the original extraction +
  // reconcileCandidateChanges flow for backward compat.
  if (ingestAddress) {
    const fromEmail = payload.FromFull?.Email ?? payload.From ?? "";
    const fromName = payload.FromFull?.Name ?? payload.FromName ?? null;

    const inboundEmail = await prisma.inboundEmail.create({
      data: {
        ingestAddressId: ingestAddress.id,
        programId: program.id,
        fromEmail,
        fromName,
        subject: payload.Subject ?? null,
        textBody:
          payload.StrippedTextReply ||
          payload.TextBody ||
          stripHtml(payload.HtmlBody) ||
          null,
        status: "RECEIVED",
      },
    });

    // Upload each attachment as its own Evidence row, linked back to this
    // InboundEmail via metadata.inboundEmailId. processInboundEmail
    // discovers them via that link and runs scope analysis on each.
    const ts = Date.now();
    const attachments = payload.Attachments ?? [];
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      try {
        const buffer = Buffer.from(att.Content, "base64");
        const fileName = safeFileName(att.Name);
        const storageKey = `${program.id}/ingest/${ts}-att-${i}-${fileName}`;
        const uploaded = await uploadEvidence(buffer, storageKey, att.ContentType);
        await prisma.evidence.create({
          data: {
            programId: program.id,
            type: "OTHER",
            fileName,
            fileSize: uploaded.fileSize,
            mimeType: att.ContentType,
            storagePath: uploaded.storagePath,
            sha256Hash: uploaded.sha256Hash,
            inboundMessageId: `${payload.MessageID}#att-${i}`,
            metadata: {
              source: "EMAIL_INGEST",
              inboundEmailId: inboundEmail.id,
              attachment: att.Name,
              fromEmail,
            } as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "attachment upload failed";
        await prisma.eventLog.create({
          data: {
            programId: program.id,
            action: "INGEST_EMAIL_FAILED",
            entityType: "InboundEmail",
            entityId: inboundEmail.id,
            metadata: {
              stage: "attachment_upload",
              error: msg,
              attachment: att.Name,
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    const { processInboundEmail } = await import("@/lib/server/inbound-email");
    try {
      const result = await processInboundEmail(inboundEmail.id);
      return NextResponse.json({
        requestId,
        ok: true,
        ingestAddress: ingestAddress.address,
        ...result,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "unknown error";
      await prisma.inboundEmail.update({
        where: { id: inboundEmail.id },
        data: { status: "FAILED", errorMessage: errMsg, processedAt: new Date() },
      });
      return NextResponse.json(
        { requestId, ok: false, inboundEmailId: inboundEmail.id, error: errMsg },
        { status: 500 },
      );
    }
  }

  const auth = parseAuthResults(payload.Headers);
  const fromDomain = senderDomain(payload);
  const allowList = program.inboundSenderAllowlist ?? [];
  const senderVerified =
    auth.spfPass &&
    auth.dkimPass &&
    fromDomain !== null &&
    (allowList.length === 0 || allowList.includes(fromDomain));

  const { evidenceType, target } = classify(payload);
  const subject = payload.Subject ?? "(no subject)";
  const ts = Date.now();

  const bodyText = payload.StrippedTextReply || payload.TextBody || stripHtml(payload.HtmlBody) || "";
  const evidences: { id: string; storagePath: string; mimeType: string }[] = [];

  if (bodyText.trim().length > 0) {
    const fileName = `email-${ts}-${safeFileName(subject)}.txt`;
    const buf = Buffer.from(bodyText, "utf-8");
    const storageKey = `programs/${program.id}/inbound/${ts}/${fileName}`;
    const uploaded = await uploadEvidence(buf, storageKey, "text/plain");

    const evidence = await prisma.evidence.create({
      data: {
        programId: program.id,
        type: evidenceType,
        fileName,
        fileSize: uploaded.fileSize,
        mimeType: "text/plain",
        storagePath: uploaded.storagePath,
        sha256Hash: uploaded.sha256Hash,
        rawHeaders: payload.Headers ? JSON.stringify(payload.Headers) : null,
        rawMime: JSON.stringify(payload),
        inboundMessageId: payload.MessageID,
        metadata: {
          source: "postmark_inbound",
          messageId: payload.MessageID,
          from: payload.From ?? null,
          subject,
          recipients,
          spfPass: auth.spfPass,
          dkimPass: auth.dkimPass,
          senderDomain: fromDomain,
          senderVerified,
        } as Prisma.InputJsonValue,
      },
    });
    evidences.push({ id: evidence.id, storagePath: uploaded.storagePath, mimeType: "text/plain" });

    await prisma.eventLog.create({
      data: {
        programId: program.id,
        action: "EVIDENCE_UPLOADED",
        entityType: "Evidence",
        entityId: evidence.id,
        metadata: {
          source: "postmark_inbound",
          messageId: payload.MessageID,
          subject,
          part: "body",
        } as Prisma.InputJsonValue,
      },
    });
  }

  for (const att of payload.Attachments ?? []) {
    const buffer = Buffer.from(att.Content, "base64");
    const fileName = safeFileName(att.Name);
    const storageKey = `programs/${program.id}/inbound/${ts}/${fileName}`;
    const uploaded = await uploadEvidence(buffer, storageKey, att.ContentType);

    // Attachments share the parent message id but each row needs a unique key:
    // append "#<index>" so the unique index doesn't collide.
    const compositeMsgId = `${payload.MessageID}#${evidences.length}`;

    const evidence = await prisma.evidence.create({
      data: {
        programId: program.id,
        type: evidenceType,
        fileName,
        fileSize: uploaded.fileSize,
        mimeType: att.ContentType,
        storagePath: uploaded.storagePath,
        sha256Hash: uploaded.sha256Hash,
        rawHeaders: payload.Headers ? JSON.stringify(payload.Headers) : null,
        inboundMessageId: compositeMsgId,
        metadata: {
          source: "postmark_inbound",
          messageId: payload.MessageID,
          attachment: att.Name,
          subject,
          spfPass: auth.spfPass,
          dkimPass: auth.dkimPass,
          senderDomain: fromDomain,
          senderVerified,
        } as Prisma.InputJsonValue,
      },
    });
    evidences.push({
      id: evidence.id,
      storagePath: uploaded.storagePath,
      mimeType: att.ContentType,
    });

    await prisma.eventLog.create({
      data: {
        programId: program.id,
        action: "EVIDENCE_UPLOADED",
        entityType: "Evidence",
        entityId: evidence.id,
        metadata: {
          source: "postmark_inbound",
          messageId: payload.MessageID,
          attachment: att.Name,
        } as Prisma.InputJsonValue,
      },
    });
  }

  // Run extraction + candidate reconciliation per evidence (best-effort).
  const allCandidates: { evidenceId: string; candidates: CandidateInput[] }[] = [];

  for (const ev of evidences) {
    const job = await prisma.extractionJob.create({
      data: {
        evidenceId: ev.id,
        programId: program.id,
        targetType: target,
        status: "PROCESSING",
        startedAt: new Date(),
      },
    });
    const startMs = Date.now();
    try {
      const result = await runExtraction(ev.storagePath, ev.mimeType, target, ev.id);
      await prisma.extractionJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          extractedData: result.extractedData as Prisma.InputJsonValue,
          confidence: result.confidence,
          tokensUsed: result.tokensUsed,
          modelUsed: result.modelUsed,
          processingTimeMs: Date.now() - startMs,
          completedAt: new Date(),
        },
      });
      await prisma.eventLog.create({
        data: {
          programId: program.id,
          action: "EXTRACTION_JOB_SUCCEEDED",
          entityType: "ExtractionJob",
          entityId: job.id,
          metadata: {
            source: "postmark_inbound",
            target,
            confidence: result.confidence,
          } as Prisma.InputJsonValue,
        },
      });

      const data = result.extractedData as Record<string, unknown>;
      let candidates: CandidateInput[] = [];
      if (target === "CHANGE_TRANSCRIPT" && Array.isArray(data?.candidates)) {
        candidates = (data.candidates as Array<Record<string, unknown>>).map((c) => ({
          changeTitle: String(c.changeTitle ?? ""),
          description: (c.description as string | null | undefined) ?? null,
          severity: (c.severity as string | null | undefined) ?? null,
          estimatedImpact: (c.estimatedImpact as number | null | undefined) ?? null,
        }));
      } else if (target === "CHANGE_EMAIL") {
        candidates = [
          {
            changeTitle: String(data?.changeTitle ?? ""),
            description: (data?.description as string | null | undefined) ?? null,
            severity: (data?.severity as string | null | undefined) ?? null,
            estimatedImpact: (data?.estimatedImpact as number | null | undefined) ?? null,
          },
        ];
      }
      candidates = candidates.filter((c) => c.changeTitle && c.changeTitle.length > 0);
      if (candidates.length) {
        allCandidates.push({ evidenceId: ev.id, candidates });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown extraction error";
      await prisma.extractionJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorMessage: msg,
          processingTimeMs: Date.now() - startMs,
          completedAt: new Date(),
        },
      });
      await prisma.eventLog.create({
        data: {
          programId: program.id,
          action: "EXTRACTION_JOB_FAILED",
          entityType: "ExtractionJob",
          entityId: job.id,
          metadata: { source: "postmark_inbound", target, error: msg } as Prisma.InputJsonValue,
        },
      });
    }
  }

  // Reconcile all candidates from this email against baseline + confirmed changes.
  const flatCandidates: CandidateInput[] = allCandidates.flatMap((g) => g.candidates);
  let reconciliationSummary: Array<Record<string, unknown>> = [];
  if (flatCandidates.length) {
    try {
      const recon = await reconcileCandidateChanges(program.id, flatCandidates, {
        senderVerified,
      });
      reconciliationSummary = recon.map((r) => ({
        candidateIndex: r.candidateIndex,
        flag: r.flag,
        confidence: r.confidence,
      }));
      const creep = recon.filter((r) => r.flag === "SCOPE_CREEP_CANDIDATE").length;
      const inBase = recon.filter((r) => r.flag === "IN_BASELINE").length;
      const already = recon.filter((r) => r.flag === "ALREADY_CONFIRMED").length;
      const needsVer = recon.filter((r) => r.flag === "NEEDS_VERIFICATION").length;

      await prisma.eventLog.create({
        data: {
          programId: program.id,
          action: "CHANGE_DRAFTED",
          entityType: "InboundEmail",
          metadata: {
            source: "postmark_inbound",
            messageId: payload.MessageID,
            subject,
            from: payload.From ?? null,
            senderDomain: fromDomain,
            senderVerified,
            spfPass: auth.spfPass,
            dkimPass: auth.dkimPass,
            candidatesTotal: flatCandidates.length,
            scopeCreep: creep,
            inBaseline: inBase,
            alreadyConfirmed: already,
            needsVerification: needsVer,
            reconciliationDetail: reconciliationSummary,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown reconciliation error";
      await prisma.eventLog.create({
        data: {
          programId: program.id,
          action: "CHANGE_DRAFTED",
          entityType: "InboundEmail",
          metadata: {
            source: "postmark_inbound",
            messageId: payload.MessageID,
            reconciliationError: msg,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }

  return NextResponse.json({
    requestId,
    ok: true,
    programId: program.id,
    evidenceIds: evidences.map((e) => e.id),
    candidates: flatCandidates.length,
    reconciliation: reconciliationSummary,
    senderVerified,
  });
}

function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
