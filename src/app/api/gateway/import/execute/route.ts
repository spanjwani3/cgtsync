import { NextRequest, NextResponse } from "next/server";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { validateRows, applyImport } from "@/lib/server/csv-import";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { programId, targetType, columnMap, rows, skipIndices } = body;

    if (!programId || !targetType || !columnMap || !rows) {
      return NextResponse.json(
        { error: "programId, targetType, columnMap, and rows are required" },
        { status: 400 }
      );
    }

    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);

    const skipSet = new Set<number>(skipIndices ?? []);
    const filteredRows = (rows as Record<string, string>[]).filter(
      (_: Record<string, string>, i: number) => !skipSet.has(i)
    );

    const validation = validateRows(filteredRows, targetType, columnMap);
    const importableRows = [...validation.valid, ...validation.warnings];

    if (importableRows.length === 0) {
      return NextResponse.json({
        createdCount: 0,
        skippedCount: skipSet.size,
        errorCount: validation.errors.length,
        errors: validation.errors.map((r) => ({
          rowIndex: r.rowIndex,
          errors: r.errors,
        })),
      });
    }

    const result = await applyImport(importableRows, targetType, programId, auth.orgId);

    await logEvent({
      programId,
      userId: auth.userId,
      action: "BULK_IMPORT",
      entityType: targetType,
      metadata: {
        targetType,
        createdCount: result.createdCount,
        skippedCount: skipSet.size,
        errorCount: validation.errors.length,
        totalRows: rows.length,
      },
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json({
      createdCount: result.createdCount,
      createdIds: result.createdIds,
      skippedCount: skipSet.size,
      errorCount: validation.errors.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("[POST /api/gateway/import/execute] Error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    );
  }
}
