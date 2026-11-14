import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { permissionDeniedResponse } from "@/lib/deletion/org-state";
import { createLogger } from "@/lib/logger/index";
import { updateIncidentResources } from "@/lib/sre/manual-incident";
import { requireSreApiPermissions, requireSreIncidentUpdateRateLimit, requireSreSameOriginRequest } from "../../../_auth";

const logger = createLogger({ module: "sre-incident-resources-api" }) as { error: (data: unknown, message?: string) => void };

/** PATCH { add?: {serviceIds, monitorIds}, remove?: {serviceIds, monitorIds} }: change an incident's affected resources. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSreSameOriginRequest(request);
  if (originError) return originError;
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "update" }]);
  if (!auth.success) return auth.response;
  const parsedId = z.string().uuid().safeParse((await params).id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid incident ID" }, { status: 400 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const limited = await requireSreIncidentUpdateRateLimit(auth.context.userId, parsedId.data);
    if (limited) return limited;
    const result = await updateIncidentResources(auth.context, parsedId.data, body as never);
    if (!result.ok) {
      if (result.code === "forbidden") return permissionDeniedResponse(auth.context.organizationId, "Insufficient permissions to update incidents");
      return NextResponse.json({ error: result.error }, { status: result.code === "not_found" ? 404 : 400 });
    }
    return NextResponse.json({ success: true, added: result.added, removed: result.removed });
  } catch (error) {
    logger.error({ error }, "Error updating incident resources");
    return NextResponse.json({ error: "Failed to update incident" }, { status: 500 });
  }
}
