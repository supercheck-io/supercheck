import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/utils/auth";
import { isImpersonatedSession } from "@/lib/rbac/middleware";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { logAuditEvent } from "@/lib/audit-logger";
import { guardMcpEnabled, mcpJson } from "@/lib/mcp/http";
import { McpConnectionNotFoundError, revokeMcpConnection } from "@/lib/mcp/connections";

export const dynamic = "force-dynamic";

/** DELETE /api/oauth/mcp/connections/:id — disconnect one agent from one project. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const disabled = guardMcpEnabled();
  if (disabled) return disabled;

  const crossOrigin = requireSameOriginRequest(request);
  if (crossOrigin) return crossOrigin;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return mcpJson({ error: "authentication_required" }, 401);

  if (await isImpersonatedSession()) {
    return mcpJson({ error: "impersonation_not_allowed" }, 403);
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return mcpJson({ error: "not_found" }, 404);

  try {
    await revokeMcpConnection({ userId: session.user.id, consentId: id });
  } catch (error) {
    if (error instanceof McpConnectionNotFoundError) return mcpJson({ error: "not_found" }, 404);
    throw error;
  }

  await logAuditEvent({
    userId: session.user.id,
    action: "mcp_connection_revoked",
    resource: "mcp_connection",
    resourceId: id,
    success: true,
  });
  return mcpJson({ success: true });
}
