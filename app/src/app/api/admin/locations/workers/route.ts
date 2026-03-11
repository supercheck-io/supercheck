import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getActiveWorkers } from "@/lib/worker-registry";

/**
 * GET /api/admin/locations/workers — List active workers (Super Admin)
 */
export async function GET() {
  try {
    await requireAdmin();
    const workers = await getActiveWorkers();
    return NextResponse.json({ success: true, data: workers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("privileges required") ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
