import { NextRequest, NextResponse } from "next/server";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { parseFile, getTargetFields } from "@/lib/server/csv-import";

const MAX_ROWS = 5000;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const programId = formData.get("programId") as string | null;

    if (!file || !programId) {
      return NextResponse.json(
        { error: "file and programId are required" },
        { status: 400 }
      );
    }

    await requireProgramAccess(programId, OrgRole.OPERATOR);

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "text/csv";
    const { headers, rows } = parseFile(buffer, mimeType);

    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `File has ${rows.length} rows, maximum is ${MAX_ROWS}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      headers,
      rows,
      previewRows: rows.slice(0, 10),
      totalRows: rows.length,
      targetFields: {
        INVOICE: getTargetFields("INVOICE"),
        BASELINE: getTargetFields("BASELINE"),
        CONTRACT: getTargetFields("CONTRACT"),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("[POST /api/gateway/import/parse] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
