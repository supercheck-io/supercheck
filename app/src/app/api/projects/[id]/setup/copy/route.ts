import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logAuditEvent } from "@/lib/audit-logger";
import { permissionDeniedResponse } from "@/lib/deletion/org-state";
import { checkPermissionWithContext, resolveProjectPermissionContext } from "@/lib/rbac/middleware";
import { checkSlidingWindowRateLimit } from "@/lib/sre/sre-rate-limiter";
import { copyConnectors, copyProviders, listConnectorIds, listProviderIds, type CopyItemResult } from "@/lib/setup/copy";
import { rateLimitResponse, readJsonBody, rejectBearer, sessionUserId } from "@/lib/setup/route-guard";
import { isUuid } from "@/lib/uuid";
import { requireSessionSameOrigin } from "@/lib/security/same-origin";

type Params = { params: Promise<{ id: string }> };

const ids = z.array(z.string().uuid()).max(10).optional();
// `all*` copies every item in the source project (up to 10 per kind), for callers that cannot list another project.
const bodySchema = z
  .object({ sourceProjectId: z.string().uuid(), providerIds: ids, connectorIds: ids, allProviders: z.boolean().optional(), allConnectors: z.boolean().optional(), limit: z.number().int().min(1).max(10).optional() })
  .strict();

const HOUR_MS = 60 * 60_000;
// Names and types are not secret and tell the user which item was copied; configs and credentials never leave copy.ts.
const strip = ({ sourceId, id, status, error, name, type }: CopyItemResult) => ({ sourceId, id, status, error, name, type });

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const bearer = rejectBearer(request);
    if (bearer) return bearer;
    const userId = await sessionUserId();
    if (userId instanceof NextResponse) return userId;
    const originError = requireSessionSameOrigin(request);
    if (originError) return originError;
    const rawId = (await params).id;
    if (!isUuid(rawId)) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const target = await resolveProjectPermissionContext(userId, rawId);
    if (!target) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const read = await readJsonBody(request);
    if (read instanceof NextResponse) return read;
    const parsed = bodySchema.safeParse(read.body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const { sourceProjectId } = parsed.data;
    const cap = parsed.data.limit ?? 10;
    let providerIds = [...new Set(parsed.data.providerIds ?? [])];
    let connectorIds = [...new Set(parsed.data.connectorIds ?? [])];
    const wantProviders = providerIds.length > 0 || Boolean(parsed.data.allProviders);
    const wantConnectors = connectorIds.length > 0 || Boolean(parsed.data.allConnectors);
    if (sourceProjectId === target.project.id) return NextResponse.json({ error: "Source and target project must differ" }, { status: 400 });
    if (!wantProviders && !wantConnectors) return NextResponse.json({ error: "Nothing to copy" }, { status: 400 });

    // Cross-org and unknown source are both "not found": never reveal another org's project.
    const source = await resolveProjectPermissionContext(userId, sourceProjectId);
    if (!source || source.organizationId !== target.organizationId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const allowed =
      (!wantProviders ||
        (checkPermissionWithContext("notification", "create", target) && checkPermissionWithContext("notification", "update", source))) &&
      (!wantConnectors ||
        (checkPermissionWithContext("sre_connector", "configure", target) && checkPermissionWithContext("sre_connector", "configure", source)));
    if (!allowed) return permissionDeniedResponse(target.organizationId, "Insufficient permissions");

    const limited =
      rateLimitResponse(await checkSlidingWindowRateLimit(`setup-copy-user:${userId}`, 10, HOUR_MS)) ??
      rateLimitResponse(await checkSlidingWindowRateLimit(`setup-copy-org:${target.organizationId}`, 30, HOUR_MS));
    if (limited) return limited;

    const scope = { organizationId: target.organizationId, sourceProjectId, targetProjectId: target.project.id, userId };
    if (parsed.data.allProviders) providerIds = [...new Set([...providerIds, ...(await listProviderIds(scope))])].slice(0, cap);
    if (parsed.data.allConnectors) connectorIds = [...new Set([...connectorIds, ...(await listConnectorIds(scope))])].slice(0, cap);
    const providers = await copyProviders(scope, providerIds);
    const connectors = await copyConnectors(scope, connectorIds);

    for (const item of providers.filter((i) => i.status === "copied")) {
      await logAuditEvent({
        userId,
        organizationId: target.organizationId,
        action: "notification_provider_created",
        resource: "notification_provider",
        resourceId: item.id,
        metadata: { providerName: item.name, providerType: item.type, projectId: target.project.id, copiedFromProjectId: sourceProjectId },
        success: true,
      });
    }
    for (const item of connectors.filter((i) => i.status === "copied")) {
      await logAuditEvent({
        userId,
        organizationId: target.organizationId,
        action: "sre_connector_created",
        resource: "sre_connector",
        resourceId: item.id,
        metadata: { projectId: target.project.id, connectorType: item.type, copiedFromProjectId: sourceProjectId },
        success: true,
      });
    }
    await logAuditEvent({
      userId,
      organizationId: target.organizationId,
      action: "project_setup.copied",
      resource: "project_setup",
      resourceId: target.project.id,
      metadata: {
        providers: providers.filter((i) => i.status === "copied").length,
        connectors: connectors.filter((i) => i.status === "copied").length,
      },
      success: true,
    });
    return NextResponse.json({ providers: providers.map(strip), connectors: connectors.map(strip) });
  } catch (error) {
    console.error("Error copying setup items:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
