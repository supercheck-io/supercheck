import { NextRequest, NextResponse } from "next/server";
import { desc, ne } from "drizzle-orm";
import { isAdminAccessDeniedError, requireAdmin } from "@/lib/admin";
import { getCurrentUser } from "@/lib/session";
import { adminDeniedResponse } from "@/lib/admin-errors";
import { db } from "@/utils/db";
import { deletionJobs } from "@/db/schema";
import { logAdminEvent } from "@/lib/audit-logger";
import { isUuid } from "@/lib/uuid";
import { retryFailedDeletion } from "@/lib/deletion/jobs";
import { triggerDeletion } from "@/lib/deletion/queue";

/** Super admin: unfinished and failed background purges (ids and counters only; no tenant content). */
export async function GET() {
  try {
    await requireAdmin();
    const rows = await db.select({
      id: deletionJobs.id, scope: deletionJobs.scope, targetId: deletionJobs.targetId, organizationId: deletionJobs.organizationId, state: deletionJobs.state,
      phase: deletionJobs.phase, cursor: deletionJobs.cursor, attempts: deletionJobs.attempts, nextAttemptAt: deletionJobs.nextAttemptAt,
      heartbeatAt: deletionJobs.heartbeatAt, lastError: deletionJobs.lastError, createdAt: deletionJobs.createdAt, startedAt: deletionJobs.startedAt,
    }).from(deletionJobs).where(ne(deletionJobs.state, "completed")).orderBy(desc(deletionJobs.createdAt)).limit(200);
    return NextResponse.json({ data: rows });
  } catch (error) {
    if (isAdminAccessDeniedError(error)) return adminDeniedResponse(error);
    console.error("[ADMIN] deletion jobs list failed:", error);
    return NextResponse.json({ error: "Failed to list deletion jobs" }, { status: 500 });
  }
}

/** Super admin: give a failed purge a fresh attempt budget. */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const admin = await getCurrentUser();
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    if (!body || typeof body.id !== "string" || !isUuid(body.id)) return NextResponse.json({ error: "A deletion job id is required" }, { status: 400 });
    if (!(await retryFailedDeletion(body.id))) return NextResponse.json({ error: "Only a failed deletion job can be retried" }, { status: 409 });
    await logAdminEvent(admin.id, "deletion_job_retried", undefined, "deletion_job", body.id);
    await triggerDeletion(body.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isAdminAccessDeniedError(error)) return adminDeniedResponse(error);
    console.error("[ADMIN] deletion job retry failed:", error);
    return NextResponse.json({ error: "Failed to retry deletion job" }, { status: 500 });
  }
}
