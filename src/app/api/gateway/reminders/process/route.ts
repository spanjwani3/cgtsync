import { NextRequest, NextResponse } from "next/server";
import { generateRequestId, structuredError } from "@/lib/config";
import { processReminderBatch } from "@/lib/server/reminders";

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    // Authenticate: either via service role key or authenticated admin
    const authHeader = req.headers.get("authorization");
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`) {
      // Service role auth — OK
    } else {
      // Fall back to regular auth check
      const { requireAuth } = await import("@/lib/server/auth");
      await requireAuth();
    }

    const result = await processReminderBatch();

    return NextResponse.json({
      requestId,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    }
    console.error(structuredError({
      requestId,
      route: "POST /api/gateway/reminders/process",
      error: e,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
