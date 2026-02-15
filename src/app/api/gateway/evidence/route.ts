import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, EvidenceType } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { uploadEvidence } from "@/lib/server/storage";
import { generateRequestId, structuredError } from "@/lib/config";
import { v4 as uuidv4 } from "uuid";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const programId = req.nextUrl.searchParams.get("programId");
    if (!programId || !UUID_RE.test(programId)) {
      return NextResponse.json(
        { requestId, error: "programId query parameter required (UUID)" },
        { status: 400 }
      );
    }
    await requireProgramAccess(programId);
    const evidences = await prisma.evidence.findMany({
      where: { programId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(evidences);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let programId: string | null = null;
  let userId: string | undefined;
  try {
    // Pre-flight: check required server env vars
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error(
        structuredError({
          requestId,
          route: "/api/gateway/evidence",
          error: "SUPABASE_SERVICE_ROLE_KEY not set",
        })
      );
      return NextResponse.json(
        { requestId, error: "Missing SUPABASE_SERVICE_ROLE_KEY. Set it in your environment variables." },
        { status: 500 }
      );
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      console.error(
        structuredError({
          requestId,
          route: "/api/gateway/evidence",
          error: "NEXT_PUBLIC_SUPABASE_URL not set",
        })
      );
      return NextResponse.json(
        { requestId, error: "Missing NEXT_PUBLIC_SUPABASE_URL. Set it in your environment variables." },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const type = formData.get("type") as string | null;
    programId = formData.get("programId") as string | null;

    if (!file || !type || !programId) {
      return NextResponse.json(
        { requestId, error: "file, type, and programId are required" },
        { status: 400 }
      );
    }

    if (!UUID_RE.test(programId)) {
      return NextResponse.json(
        { requestId, error: "programId must be a valid UUID" },
        { status: 400 }
      );
    }

    const validTypes = Object.values(EvidenceType);
    if (!validTypes.includes(type as EvidenceType)) {
      return NextResponse.json(
        { requestId, error: `type must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;
    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = `${programId}/${uuidv4()}/${file.name}`;
    const result = await uploadEvidence(
      buffer,
      storagePath,
      file.type || "application/octet-stream"
    );

    // Calculate retention
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: { retentionDays: true },
    });
    const retainUntil = program?.retentionDays
      ? new Date(Date.now() + program.retentionDays * 24 * 60 * 60 * 1000)
      : null;

    const evidence = await prisma.evidence.create({
      data: {
        programId,
        type: type as EvidenceType,
        fileName: file.name,
        fileSize: result.fileSize,
        mimeType: file.type || "application/octet-stream",
        storagePath: result.storagePath,
        sha256Hash: result.sha256Hash,
        retainUntil,
      },
    });

    await logEvent({
      programId,
      userId: auth.userId,
      action: "EVIDENCE_UPLOADED",
      entityType: "Evidence",
      entityId: evidence.id,
      metadata: {
        fileName: file.name,
        fileSize: result.fileSize,
        sha256Hash: result.sha256Hash,
        type,
      },
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json({ requestId, ...evidence }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND")
      return NextResponse.json({ requestId, error: "Not found" }, { status: 404 });

    // Actionable infra errors — surface to client
    if (msg.startsWith("Missing ") || msg.includes("Bucket")) {
      console.error(
        structuredError({
          requestId,
          route: "/api/gateway/evidence",
          error: e,
          userId,
          programId: programId ?? undefined,
        })
      );
      return NextResponse.json({ requestId, error: msg }, { status: 500 });
    }

    console.error(
      structuredError({
        requestId,
        route: "/api/gateway/evidence",
        error: e,
        userId,
        programId: programId ?? undefined,
      })
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}
