import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { reports, runs, projects } from "@/db/schema";
import { desc, eq, or, sql } from "drizzle-orm";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { getPermissionResource, resolveAccessContext } from "@/lib/test-results-access";
import { buildReportUrl, getReportsOrigin, mintReportToken } from "@/lib/reports-origin";

const BASE = "/api/test-results/";

/**
 * POST /api/report-urls { path: "/api/test-results/<id>/report/index.html?..." }
 * Returns { url } on the cookieless reports origin with a short-lived signed token, after the same
 * permission check the report route applies. { url: null } when REPORTS_ORIGIN is not configured.
 */
export async function POST(request: Request) {
  const origin = getReportsOrigin();
  if (!origin) return NextResponse.json({ url: null });

  let authContext: Awaited<ReturnType<typeof requireUserAuthContext>>;
  try {
    authContext = await requireUserAuthContext();
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    throw error;
  }

  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const requested = typeof body?.path === "string" ? body.path : "";
  if (!requested.startsWith(BASE) || requested.length > 2048) {
    return NextResponse.json({ error: "Invalid report path" }, { status: 400 });
  }
  const parsed = new URL(requested, "http://placeholder.invalid");
  const segments = parsed.pathname.slice(BASE.length).split("/").filter(Boolean);
  const entityId = segments[0] === "jobs" || segments[0] === "tests" ? segments[1] : segments[0];
  if (!entityId) return NextResponse.json({ error: "Invalid report path" }, { status: 400 });

  // Same ownership resolution as the report route, including runs that have no report row yet.
  let resource: ReturnType<typeof getPermissionResource> = null;
  let organizationId: string | null = null;
  let projectId: string | null = null;
  const rows = await db
    .select({ entityType: reports.entityType })
    .from(reports)
    .where(eq(reports.entityId, entityId))
    .orderBy(desc(reports.updatedAt));
  if (rows.length) {
    const row = rows.find((r) => r.entityType === "k6_test" || r.entityType === "k6_job") ?? rows[0];
    resource = getPermissionResource(row.entityType);
    const access = await resolveAccessContext(row.entityType, entityId);
    organizationId = access?.organizationId ?? null;
    projectId = access?.projectId ?? null;
  } else {
    const [run] = await db
      .select({ projectId: runs.projectId })
      .from(runs)
      .where(or(eq(runs.id, entityId), sql`${runs.metadata}->>'testId' = ${entityId}`))
      .orderBy(desc(runs.createdAt))
      .limit(1);
    if (run?.projectId) {
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, run.projectId),
        columns: { organizationId: true },
      });
      resource = "run";
      organizationId = project?.organizationId ?? null;
      projectId = run.projectId;
    }
  }

  if (!resource || !organizationId || !projectId) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
  if (authContext.isCliAuth && authContext.projectId !== projectId) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
  if (!(await hasPermissionForUser(authContext.userId, resource, "view", { organizationId, projectId }))) {
    return NextResponse.json({ error: "Insufficient permissions to view this report" }, { status: 403 });
  }

  let token: string;
  try {
    token = mintReportToken(entityId, projectId);
  } catch (error) {
    console.error("[REPORT-URLS] Cannot sign report URL:", error);
    return NextResponse.json({ error: "Report links are unavailable" }, { status: 500 });
  }
  const rest = parsed.pathname.slice(BASE.length);
  return NextResponse.json(
    { url: `${buildReportUrl(origin, token, rest)}${parsed.search}` },
    { headers: { "Cache-Control": "no-store" } }
  );
}
