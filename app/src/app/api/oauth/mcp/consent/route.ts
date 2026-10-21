import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/utils/auth";
import { mcpAuthApi } from "@/lib/mcp/auth-api";
import { isSafeRedirectTarget } from "@/lib/mcp/redirect";
import { isImpersonatedSession } from "@/lib/rbac/middleware";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { logAuditEvent } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger/pino-config";
import { guardMcpEnabled, mcpJson, readJsonBody } from "@/lib/mcp/http";
import {
  McpProjectAccessError,
  clearProjectSelection,
  saveProjectSelection,
} from "@/lib/mcp/project-selection";

const logger = createLogger({ module: "mcp-consent" });

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  accept: z.boolean(),
  projectId: z.string().uuid().optional(),
  // The signed authorization request Better Auth put on the consent page URL.
  oauth_query: z.string().min(1).max(8192),
});

/**
 * POST /api/oauth/mcp/consent — the user's decision on the connect screen.
 *
 * Approving records which project the agent may read, then lets Better Auth
 * issue the authorization code; the redirect URL it returns goes back to the
 * client. Denying returns the client to its redirect URI with an error.
 */
export async function POST(request: NextRequest) {
  const disabled = guardMcpEnabled();
  if (disabled) return disabled;

  const crossOrigin = requireSameOriginRequest(request);
  if (crossOrigin) return crossOrigin;

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) return mcpJson({ error: "authentication_required" }, 401);

  // A connection authorized while impersonating would belong to the impersonated
  // user and outlive the impersonation.
  if (await isImpersonatedSession()) {
    return mcpJson({ error: "impersonation_not_allowed" }, 403);
  }

  const raw = await readJsonBody(request);
  const parsed = raw ? bodySchema.safeParse(raw) : null;
  if (!parsed?.success) return mcpJson({ error: "invalid_request" }, 400);
  const { accept, projectId, oauth_query: oauthQuery } = parsed.data;

  // The code and the denial both go back to this URI. Refuse an unusable one now: once
  // consent is recorded, an undeliverable code would leave a connection the client never got.
  if (!isSafeRedirectTarget(new URLSearchParams(oauthQuery).get("redirect_uri"))) {
    return mcpJson({ error: "invalid_request" }, 400);
  }

  const userId = session.user.id;
  const sessionId = session.session.id;

  if (accept) {
    if (!projectId) return mcpJson({ error: "project_required" }, 400);
    try {
      await saveProjectSelection({ sessionId, userId, projectId });
    } catch (error) {
      if (error instanceof McpProjectAccessError) return mcpJson({ error: "forbidden" }, 403);
      throw error;
    }
  }

  try {
    const result = await mcpAuthApi().oauth2Consent({
      headers: requestHeaders,
      body: { accept, oauth_query: oauthQuery },
    });
    const url = result?.url ?? result?.redirect_uri;
    if (!isSafeRedirectTarget(url)) return mcpJson({ error: "consent_failed" }, 502);

    await logAuditEvent({
      userId,
      action: accept ? "mcp_connection_approved" : "mcp_connection_denied",
      resource: "mcp_connection",
      resourceId: projectId,
      metadata: { projectId: projectId ?? null },
      success: true,
    });
    return mcpJson({ url });
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.name : "unknown" }, "MCP consent failed");
    return mcpJson({ error: "consent_failed" }, 400);
  } finally {
    // The choice is single-use: a later connection picks again. Only an approval stored one,
    // and only that exact value is removed, so a denial (or a second tab) cannot delete the
    // choice another approval is about to read.
    if (accept && projectId) {
      await clearProjectSelection({ sessionId, userId, projectId }).catch(() => undefined);
    }
  }
}
