import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, EvidenceType } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { uploadEvidence } from "@/lib/server/storage";
import { v4 as uuidv4 } from "uuid";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    // Pre-flight: check required server env vars
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Evidence upload: SUPABASE_SERVICE_ROLE_KEY not set");
      return NextResponse.json(
        { error: "Missing SUPABASE_SERVICE_ROLE_KEY. Set it in your environment variables." },
        { status: 500 }
      );
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      console.error("Evidence upload: NEXT_PUBLIC_SUPABASE_URL not set");
      return NextResponse.json(
        { error: "Missing NEXT_PUBLIC_SUPABASE_URL. Set it in your environment variables." },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const type = formData.get("type") as string | null;
    const programId = formData.get("programId") as string | null;

    if (!file || !type || !programId) {
      return NextResponse.json(
        { error: "file, type, and programId are required" },
        { status: 400 }
      );
    }

    if (!UUID_RE.test(programId)) {
      return NextResponse.json(
        { error: "programId must be a valid UUID" },
        { status: 400 }
      );
    }

    const validTypes = Object.values(EvidenceType);
    if (!validTypes.includes(type as EvidenceType)) {
      return NextResponse.json(
        { error: `type must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
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

    return NextResponse.json(evidence, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND")
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Actionable infra errors — surface to client
    if (msg.startsWith("Missing ") || msg.includes("Bucket")) {
      console.error("Evidence upload infra error:", msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    console.error("Evidence upload error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
