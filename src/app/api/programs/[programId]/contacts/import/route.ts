import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { parseFile } from "@/lib/server/csv-import";
import { logEvent, getClientIp } from "@/lib/server/event-log";

const VALID_CONTACT_TYPES = ["CLIENT", "INTERNAL", "OTHER"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ programId: string }> }
) {
  try {
    const { programId } = await params;
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseFile(buffer, file.type);

    if (parsed.rows.length === 0) {
      return NextResponse.json({ error: "File contains no data rows" }, { status: 400 });
    }

    // Auto-detect column mapping (case-insensitive header matching)
    const headerMap: Record<string, string> = {};
    const fieldMappings: Record<string, string[]> = {
      name: ["name", "contact name", "full name", "fullname"],
      email: ["email", "email address", "e-mail"],
      title: ["title", "job title", "role"],
      organizationName: ["organization", "organization name", "company", "org"],
      contactType: ["type", "contact type", "contacttype"],
      phone: ["phone", "phone number", "tel", "telephone"],
    };

    for (const header of parsed.headers) {
      const lower = header.toLowerCase().trim();
      for (const [field, aliases] of Object.entries(fieldMappings)) {
        if (aliases.includes(lower)) {
          headerMap[field] = header;
          break;
        }
      }
    }

    if (!headerMap.name || !headerMap.email) {
      return NextResponse.json({
        error: "Could not find required columns. File must have 'Name' and 'Email' columns.",
        detectedHeaders: parsed.headers,
      }, { status: 400 });
    }

    // Validate and prepare rows
    const errors: { row: number; error: string }[] = [];
    const validRows: { name: string; email: string; title?: string; organizationName?: string; contactType: string; phone?: string }[] = [];

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      const name = row[headerMap.name]?.trim();
      const email = row[headerMap.email]?.trim();

      if (!name) { errors.push({ row: i + 2, error: "Missing name" }); continue; }
      if (!email || !email.includes("@")) { errors.push({ row: i + 2, error: "Invalid email" }); continue; }

      let contactType = "CLIENT";
      if (headerMap.contactType) {
        const raw = row[headerMap.contactType]?.trim().toUpperCase();
        if (raw && VALID_CONTACT_TYPES.includes(raw)) contactType = raw;
      }

      validRows.push({
        name,
        email,
        title: headerMap.title ? row[headerMap.title]?.trim() || undefined : undefined,
        organizationName: headerMap.organizationName ? row[headerMap.organizationName]?.trim() || undefined : undefined,
        contactType,
        phone: headerMap.phone ? row[headerMap.phone]?.trim() || undefined : undefined,
      });
    }

    if (validRows.length === 0) {
      return NextResponse.json({ error: "No valid rows found", errors }, { status: 400 });
    }

    // Bulk create
    const created = await prisma.programContact.createMany({
      data: validRows.map((r) => ({
        programId,
        orgId: auth.orgId,
        name: r.name,
        email: r.email,
        title: r.title ?? null,
        organizationName: r.organizationName ?? null,
        contactType: r.contactType as "CLIENT" | "INTERNAL" | "OTHER",
        phone: r.phone ?? null,
      })),
    });

    await logEvent({
      programId,
      userId: auth.userId,
      action: "BULK_IMPORT",
      entityType: "ProgramContact",
      ipAddress: getClientIp(req.headers),
      metadata: { imported: created.count, errors: errors.length },
    });

    return NextResponse.json({
      imported: created.count,
      errors,
      totalRows: parsed.rows.length,
    }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[POST /api/programs/:id/contacts/import] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
