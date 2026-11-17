import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { sreIncidents } from "@/db/schema";
import { listIncidentResources } from "@/lib/sre/incident-resources";
import { db } from "@/utils/db";

import { permissionDeniedResponse } from "@/lib/deletion/org-state";
import { createLogger } from "@/lib/logger/index";
import { updateIncidentResources } from "@/lib/sre/manual-incident";
import { requireSreApiPermissions, requireSreIncidentUpdateRateLimit, requireSreSameOriginRequest } from "../../../_auth";
import { readJsonBody } from "@/lib/http/read-capped-json";

const MAX_BODY_BYTES = 256 * 1024;

const logger = createLogger({ module: "sre-incident-resources-api" }) as { error: (data: unknown, message?: string) => void };

/** PATCH { add?: {serviceIds, monitorIds}, remove?: {serviceIds, monitorIds} }: change an incident's affected resources. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSreSameOriginRequest(request);
  if (originError) return originError;
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "update" }]);
  if (!auth.success) return auth.response;
  // Lowercase, so a differently cased id shares the same rate-limit bucket and row.
  const parsedId = z.string().uuid().transform((id) => id.toLowerCase()).safeParse((await params).id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid incident ID" }, { status: 400 });
  let body: unknown;
  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (read instanceof NextResponse) return read;
  body = read.body;
  try {
    const limited = await requireSreIncidentUpdateRateLimit(auth.context.userId, parsedId.data);
    if (limited) return limited;
    const result = await updateIncidentResources(auth.context, parsedId.data, body as never);
    if (!result.ok) {
      if (result.code === "forbidden") return permissionDeniedResponse(auth.context.organizationId, "Insufficient permissions to update incidents");
      return NextResponse.json({ error: result.error }, { status: result.code === "not_found" ? 404 : result.code === "conflict" ? 409 : 400 });
    }
    return NextResponse.json({ success: true, added: result.added, removed: result.removed });
  } catch (error) {
    logger.error({ error }, "Error updating incident resources");
    return NextResponse.json({ error: "Failed to update incident" }, { status: 500 });
  }
}

/** GET: the incident's affected services and monitors, with names. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "view" }]);
  if (!auth.success) return auth.response;
  // Lowercase, so a differently cased id shares the same rate-limit bucket and row.
  const parsedId = z.string().uuid().transform((id) => id.toLowerCase()).safeParse((await params).id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid incident ID" }, { status: 400 });
  const scope = { organizationId: auth.context.organizationId, projectId: auth.context.project.id };
  const [incident] = await db
    .select({ id: sreIncidents.id })
    .from(sreIncidents)
    .where(and(eq(sreIncidents.id, parsedId.data), eq(sreIncidents.organizationId, scope.organizationId), eq(sreIncidents.projectId, scope.projectId)))
    .limit(1);
  if (!incident) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  return NextResponse.json({ success: true, resources: await listIncidentResources(scope, incident.id) });
}
