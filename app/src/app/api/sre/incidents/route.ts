import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sreIncidents, sreServices } from "@/db/schema";
import { requireSreApiPermissions, requireSreSameOriginRequest } from "../_auth";
import { permissionDeniedResponse } from "@/lib/deletion/org-state";
import { createLogger } from "@/lib/logger/index";
import { createManualIncident } from "@/lib/sre/manual-incident";
import { db } from "@/utils/db";
import { getDisplayStatus } from "@/lib/sre/incident-status-display";
import { storedRootCause } from "@/lib/sre/evidence-brief-summary";
import { readJsonBody } from "@/lib/http/read-capped-json";

const MAX_BODY_BYTES = 256 * 1024;

// One more row is fetched to tell the caller the list was cut.
const INCIDENT_LIST_LIMIT = 500;

const querySchema = z.object({
  incidentNumber: z.coerce.number().int().positive().max(2147483647).optional(),
  status: z.enum(["open", "triggered", "investigating", "identified", "recommendations_ready", "user_applying_fix", "verifying", "resolved"]).optional(),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]).optional(),
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.string().uuid()]).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "view" }]);
  if (!auth.success) return auth.response;

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid incident filters" }, { status: 400 });
  }

  const filters = [
    eq(sreIncidents.organizationId, auth.context.organizationId),
    eq(sreIncidents.projectId, auth.context.project.id),
  ];
  if (parsed.data.status === "open") filters.push(ne(sreIncidents.status, "resolved"));
  else if (parsed.data.status) filters.push(eq(sreIncidents.status, parsed.data.status));
  if (parsed.data.severity) filters.push(eq(sreIncidents.severity, parsed.data.severity));
  if (parsed.data.assignee === "unassigned") filters.push(isNull(sreIncidents.assigneeUserId));
  else if (parsed.data.assignee === "me") filters.push(eq(sreIncidents.assigneeUserId, auth.context.userId));
  else if (parsed.data.assignee) filters.push(eq(sreIncidents.assigneeUserId, parsed.data.assignee));
  if (parsed.data.incidentNumber) filters.push(eq(sreIncidents.incidentNumber, parsed.data.incidentNumber));

  const incidents = await db
    .select({
      id: sreIncidents.id,
      incidentNumber: sreIncidents.incidentNumber,
      title: sreIncidents.title,
      severity: sreIncidents.severity,
      status: sreIncidents.status,
      primaryServiceId: sreIncidents.primaryServiceId,
      primaryServiceName: sreServices.name,
      alertCount: sreIncidents.alertCount,
      lastAlertAt: sreIncidents.lastAlertAt,
      assigneeUserId: sreIncidents.assigneeUserId,
      acknowledgedAt: sreIncidents.acknowledgedAt,
      acknowledgedByUserId: sreIncidents.acknowledgedByUserId,
      commanderUserId: sreIncidents.commanderUserId,
      mitigatedAt: sreIncidents.mitigatedAt,
      resolutionSummary: sreIncidents.resolutionSummary,
      rootCauseSummary: sreIncidents.rootCauseSummary,
      confidenceScore: sreIncidents.confidenceScore,
      resolvedAt: sreIncidents.resolvedAt,
      createdAt: sreIncidents.createdAt,
      updatedAt: sreIncidents.updatedAt,
    })
    .from(sreIncidents)
    .leftJoin(sreServices, eq(sreIncidents.primaryServiceId, sreServices.id))
    .where(and(...filters))
    .orderBy(desc(sreIncidents.updatedAt))
    .limit(INCIDENT_LIST_LIMIT + 1);

  return NextResponse.json({
    success: true,
    // statusLabel is the user-facing status (six values); status stays the stored value.
    truncated: incidents.length > INCIDENT_LIST_LIMIT,
    incidents: incidents.slice(0, INCIDENT_LIST_LIMIT).map((incident) => ({
      ...incident,
      rootCauseSummary: storedRootCause(incident.rootCauseSummary),
      statusLabel: getDisplayStatus(incident.status, incident.acknowledgedAt).label,
    })),
  });
}

const logger = createLogger({ module: "sre-incident-create-api" }) as { error: (data: unknown, message?: string) => void };

/** POST /api/sre/incidents: declare an incident (UI-equivalent core; the CLI calls this route). */
export async function POST(request: NextRequest) {
  const originError = requireSreSameOriginRequest(request);
  if (originError) return originError;
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "create" }]);
  if (!auth.success) return auth.response;
  let body: unknown;
  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (read instanceof NextResponse) return read;
  body = read.body;
  try {
    // Audit detail only: the CLI identifies itself in its User-Agent.
    const source = request.headers.get("user-agent")?.startsWith("supercheck-cli/") ? "cli" : "api";
    const result = await createManualIncident(auth.context, body as never, source);
    if (!result.ok) {
      if (result.code === "forbidden") return permissionDeniedResponse(auth.context.organizationId, "Insufficient permissions to create incidents");
      if (result.code === "subscription_required") return NextResponse.json({ error: result.error, code: result.code }, { status: 402 });
      if (result.code === "rate_limited") {
        return NextResponse.json({ error: result.error }, { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } });
      }
      return NextResponse.json(
        { error: result.error, ...(result.code === "invalid" && result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) },
        { status: result.code === "not_found" ? 404 : 400 },
      );
    }
    return NextResponse.json(
      { success: true, incident: result.incident, ...(result.statusPageIncidentId ? { statusPageIncidentId: result.statusPageIncidentId } : {}), ...(result.warning ? { warning: result.warning } : {}) },
      { status: 201 },
    );
  } catch (error) {
    logger.error({ error }, "Error declaring SRE incident");
    return NextResponse.json({ error: "Failed to create incident" }, { status: 500 });
  }
}
