import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, ClauseType, ChangeSeverity, TermType, Prisma } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { generateRequestId, structuredError } from "@/lib/config";
import { hasChangeExtendedColumns, CHANGE_BASE_SELECT, CHANGE_EXTENDED_SELECT } from "@/lib/server/change-compat";

const VALID_CLAUSE_TYPES = new Set(Object.values(ClauseType));
const VALID_SEVERITIES = new Set(Object.values(ChangeSeverity));
const VALID_TERM_TYPES = new Set(Object.values(TermType));

/**
 * POST /api/gateway/extraction/[jobId]/apply
 * Apply extracted data to create entities.
 *
 * For BASELINE: body { baselineId } — creates clauses on the given baseline.
 * For INVOICE:  body { invoiceId } — creates line items + updates invoice header.
 * For CHANGE_ORDER: body {} — creates a Change record on the program.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  let programId: string | undefined;
  try {
    const { jobId } = await params;
    const job = await prisma.extractionJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json({ requestId, error: "Job not found" }, { status: 404 });
    }
    if (job.status !== "COMPLETED") {
      return NextResponse.json(
        { requestId, error: "Can only apply completed extraction jobs" },
        { status: 400 }
      );
    }

    programId = job.programId;
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    const body = await req.json();
    const data = job.extractedData as Record<string, unknown> | null;
    if (!data) {
      return NextResponse.json(
        { requestId, error: "No extracted data on this job" },
        { status: 400 }
      );
    }

    // Check migration status for change-related branches
    const extended = await hasChangeExtendedColumns(prisma);
    const changeSelect = extended ? CHANGE_EXTENDED_SELECT : CHANGE_BASE_SELECT;

    let createdCount = 0;

    if (job.targetType === "BASELINE") {
      const { baselineId } = body;
      if (!baselineId) {
        return NextResponse.json(
          { requestId, error: "baselineId required for BASELINE extraction" },
          { status: 400 }
        );
      }
      const baseline = await prisma.baseline.findUnique({
        where: { id: baselineId },
        select: { programId: true, status: true },
      });
      if (!baseline || baseline.programId !== programId) {
        return NextResponse.json({ requestId, error: "Baseline not found" }, { status: 404 });
      }
      if (baseline.status !== "DRAFT") {
        return NextResponse.json(
          { requestId, error: "Can only add clauses to DRAFT baselines" },
          { status: 400 }
        );
      }

      const clauses = data.clauses as Array<{
        clauseRef?: string;
        type?: string;
        title?: string;
        description?: string;
        value?: number;
        unit?: string;
      }>;
      if (!Array.isArray(clauses) || clauses.length === 0) {
        return NextResponse.json(
          { requestId, error: "No clauses found in extracted data" },
          { status: 400 }
        );
      }

      const maxOrder = await prisma.baselineClause.aggregate({
        where: { baselineId },
        _max: { sortOrder: true },
      });
      let sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

      for (const c of clauses) {
        if (!c.title) continue;
        const clauseType = VALID_CLAUSE_TYPES.has(c.type as ClauseType)
          ? (c.type as ClauseType)
          : "OTHER";

        await prisma.baselineClause.create({
          data: {
            baselineId,
            clauseRef: c.clauseRef ?? null,
            type: clauseType,
            title: c.title,
            description: c.description ?? null,
            value: c.value ?? null,
            unit: c.unit ?? null,
            sortOrder: sortOrder++,
          },
        });
        createdCount++;
      }
    } else if (job.targetType === "INVOICE") {
      const { invoiceId } = body;
      if (!invoiceId) {
        return NextResponse.json(
          { requestId, error: "invoiceId required for INVOICE extraction" },
          { status: 400 }
        );
      }
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { programId: true },
      });
      if (!invoice || invoice.programId !== programId) {
        return NextResponse.json({ requestId, error: "Invoice not found" }, { status: 404 });
      }

      // Update invoice header if extracted
      const headerUpdate: Prisma.InvoiceUpdateInput = {};
      if (data.invoiceNumber) headerUpdate.invoiceNumber = String(data.invoiceNumber);
      if (data.vendorName) headerUpdate.vendorName = String(data.vendorName);
      if (data.invoiceDate) headerUpdate.invoiceDate = new Date(String(data.invoiceDate));
      if (data.totalAmount !== null && data.totalAmount !== undefined)
        headerUpdate.totalAmount = Number(data.totalAmount);
      if (data.currency) headerUpdate.currency = String(data.currency);

      if (Object.keys(headerUpdate).length > 0) {
        await prisma.invoice.update({ where: { id: invoiceId }, data: headerUpdate });
      }

      const lineItems = data.lineItems as Array<{
        description?: string;
        quantity?: number;
        unitPrice?: number;
        amount?: number;
      }>;
      if (Array.isArray(lineItems) && lineItems.length > 0) {
        const maxOrder = await prisma.invoiceLineItem.aggregate({
          where: { invoiceId },
          _max: { sortOrder: true },
        });
        let sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

        for (const li of lineItems) {
          if (!li.description || li.amount === undefined) continue;
          await prisma.invoiceLineItem.create({
            data: {
              invoiceId,
              description: li.description,
              quantity: li.quantity ?? null,
              unitPrice: li.unitPrice ?? null,
              amount: li.amount,
              sortOrder: sortOrder++,
            },
          });
          createdCount++;
        }
      }
    } else if (job.targetType === "CHANGE_ORDER") {
      const changeTitle = data.changeTitle as string | undefined;
      if (!changeTitle) {
        return NextResponse.json(
          { requestId, error: "No change title found in extracted data" },
          { status: 400 }
        );
      }

      const severity = VALID_SEVERITIES.has(data.severity as ChangeSeverity)
        ? (data.severity as ChangeSeverity)
        : "MEDIUM";

      const maxSeq = await prisma.change.aggregate({
        where: { programId },
        _max: { sequenceNum: true },
      });
      const sequenceNum = (maxSeq._max.sequenceNum ?? 0) + 1;

      const createData: Record<string, unknown> = {
        programId,
        sequenceNum,
        title: changeTitle,
        description: (data.description as string) ?? null,
        severity,
        estimatedImpact: data.estimatedImpact != null ? Number(data.estimatedImpact) : null,
        evidenceFileId: job.evidenceId,
      };

      const change = await prisma.change.create({
        data: createData as any,
        select: changeSelect,
      });

      await logEvent({
        programId,
        userId,
        action: "CHANGE_DRAFTED",
        entityType: "Change",
        entityId: change.id,
        metadata: { sequenceNum, title: changeTitle, fromExtraction: true, jobId },
        ipAddress: getClientIp(req.headers),
      });
      createdCount = 1;
    } else if (job.targetType === "CHANGE_TRANSCRIPT") {
      // Multi-candidate: user selects which candidates to create
      const candidates = data.candidates as Array<{
        changeTitle?: string;
        description?: string;
        severity?: string;
        estimatedImpact?: number;
        scheduleImpactDays?: number;
        speaker?: string;
      }>;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        return NextResponse.json(
          { requestId, error: "No candidates found in extracted data" },
          { status: 400 }
        );
      }

      const selectedIndices: number[] = body.selectedIndices ?? candidates.map((_: unknown, i: number) => i);
      const selected = selectedIndices
        .filter((i: number) => i >= 0 && i < candidates.length)
        .map((i: number) => candidates[i]);

      if (selected.length === 0) {
        return NextResponse.json(
          { requestId, error: "No candidates selected" },
          { status: 400 }
        );
      }

      const maxSeq = await prisma.change.aggregate({
        where: { programId },
        _max: { sequenceNum: true },
      });
      let sequenceNum = (maxSeq._max.sequenceNum ?? 0) + 1;

      for (const c of selected) {
        if (!c.changeTitle) continue;
        const severity = VALID_SEVERITIES.has(c.severity as ChangeSeverity)
          ? (c.severity as ChangeSeverity)
          : "MEDIUM";

        const createData: Record<string, unknown> = {
          programId,
          sequenceNum: sequenceNum++,
          title: c.changeTitle,
          description: c.description ?? (c.speaker ? `Proposed by ${c.speaker}` : null),
          severity,
          estimatedImpact: c.estimatedImpact != null ? Number(c.estimatedImpact) : null,
          evidenceFileId: job.evidenceId,
        };
        if (extended && c.scheduleImpactDays != null) {
          createData.scheduleImpactDays = c.scheduleImpactDays;
        }

        const change = await prisma.change.create({
          data: createData as any,
          select: changeSelect,
        });

        await logEvent({
          programId,
          userId,
          action: "CHANGE_DRAFTED",
          entityType: "Change",
          entityId: change.id,
          metadata: { sequenceNum: change.sequenceNum, title: c.changeTitle, fromExtraction: true, jobId, source: "transcript" },
          ipAddress: getClientIp(req.headers),
        });
        createdCount++;
      }
    } else if (job.targetType === "CHANGE_EMAIL") {
      const changeTitle = data.changeTitle as string | undefined;
      if (!changeTitle) {
        return NextResponse.json(
          { requestId, error: "No change title found in extracted email" },
          { status: 400 }
        );
      }

      const severity = VALID_SEVERITIES.has(data.severity as ChangeSeverity)
        ? (data.severity as ChangeSeverity)
        : "MEDIUM";

      const maxSeq = await prisma.change.aggregate({
        where: { programId },
        _max: { sequenceNum: true },
      });
      const sequenceNum = (maxSeq._max.sequenceNum ?? 0) + 1;

      // Build description with email context
      const parts: string[] = [];
      if (data.sender) parts.push(`From: ${data.sender}${data.senderRole ? ` (${data.senderRole})` : ""}`);
      if (data.dateSent) parts.push(`Date: ${data.dateSent}`);
      if (data.description) parts.push(String(data.description));
      const description = parts.join("\n") || null;

      const createData: Record<string, unknown> = {
        programId,
        sequenceNum,
        title: changeTitle,
        description,
        severity,
        estimatedImpact: data.estimatedImpact != null ? Number(data.estimatedImpact) : null,
        evidenceFileId: job.evidenceId,
      };
      if (extended && data.scheduleImpactDays != null) {
        createData.scheduleImpactDays = Number(data.scheduleImpactDays);
      }

      const change = await prisma.change.create({
        data: createData as any,
        select: changeSelect,
      });

      await logEvent({
        programId,
        userId,
        action: "CHANGE_DRAFTED",
        entityType: "Change",
        entityId: change.id,
        metadata: { sequenceNum, title: changeTitle, fromExtraction: true, jobId, source: "email" },
        ipAddress: getClientIp(req.headers),
      });
      createdCount = 1;
    } else if (job.targetType === "TERMS") {
      const terms = data.terms as Array<{
        termType?: string;
        label?: string;
        dateOrOffset?: string;
        costOrPercent?: string;
        conditions?: string;
        excerpt?: string;
        page?: number;
        confidence?: number;
      }>;
      if (!Array.isArray(terms) || terms.length === 0) {
        return NextResponse.json(
          { requestId, error: "No terms found in extracted data" },
          { status: 400 }
        );
      }

      const maxOrder = await prisma.commitmentTerm.aggregate({
        where: { programId },
        _max: { sortOrder: true },
      });
      let sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

      for (const t of terms) {
        if (!t.label) continue;
        const termType = VALID_TERM_TYPES.has(t.termType as TermType)
          ? (t.termType as TermType)
          : "COMMITMENT_DATE";

        // Parse dateOrOffset into a concrete deadline if it looks like a date
        let deadlineAt: Date | null = null;
        if (t.dateOrOffset) {
          const parsed = Date.parse(t.dateOrOffset);
          if (!isNaN(parsed)) deadlineAt = new Date(parsed);
        }

        const term = await prisma.commitmentTerm.create({
          data: {
            programId,
            evidenceId: job.evidenceId,
            termType,
            label: t.label,
            dateOrOffset: t.dateOrOffset ?? null,
            deadlineAt,
            costOrPercent: t.costOrPercent ?? null,
            conditions: t.conditions ?? null,
            excerpt: t.excerpt ?? null,
            page: t.page ?? null,
            confidence: t.confidence ?? null,
            sortOrder: sortOrder++,
          },
        });

        await logEvent({
          programId,
          userId,
          action: "TERM_IMPORTED",
          entityType: "CommitmentTerm",
          entityId: term.id,
          metadata: { termType, label: t.label, fromExtraction: true, jobId },
          ipAddress: getClientIp(req.headers),
        });
        createdCount++;
      }
    }

    await logEvent({
      programId,
      userId,
      action: "EXTRACTION_JOB_APPLIED",
      entityType: "ExtractionJob",
      entityId: jobId,
      metadata: { targetType: job.targetType, createdCount },
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json({
      requestId,
      applied: true,
      targetType: job.targetType,
      createdCount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(
      structuredError({
        requestId,
        route: "/api/gateway/extraction/[jobId]/apply",
        error: e,
        userId,
        programId,
      })
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}
