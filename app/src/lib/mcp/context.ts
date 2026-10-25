import { and, eq } from "drizzle-orm";
import type { JWTPayload } from "jose";
import { oauthClient, oauthConsent, user } from "@/db/schema";
import { isCredentialOwnerActive } from "@/lib/security/credential-owner";
import { db } from "@/utils/db";
import {
  checkPermissionWithContext,
  resolveProjectPermissionContext,
} from "@/lib/rbac/middleware";
import { MCP_PROJECT_CLAIM, MCP_READ_SCOPE } from "./config";

/** What a tool call runs as: one user, in one project, through one client. */
export interface McpCallContext {
  userId: string;
  clientId: string;
  organizationId: string;
  projectId: string;
  role: string;
}

export class McpAccessDeniedError extends Error {
  constructor(readonly reason: string) {
    super(`MCP access denied: ${reason}`);
    this.name = "McpAccessDeniedError";
  }
}

/**
 * Re-checks authority on every request, independent of what the 15-minute JWT claims.
 * A JWT cannot be revoked, so Disconnect, project removal and bans must take effect here:
 *  1. the token names a project;
 *  2. the user is not banned (an expired ban no longer counts);
 *  3. the (client, user, project) consent row still exists and covers mcp:read;
 *  4. the user still has a role on the project and may view it.
 */
export async function resolveMcpCallContext(claims: JWTPayload): Promise<McpCallContext> {
  const userId = typeof claims.sub === "string" ? claims.sub : null;
  const clientId = typeof claims.azp === "string" ? claims.azp : null;
  const projectId = claims[MCP_PROJECT_CLAIM];
  if (!userId || !clientId || typeof projectId !== "string" || !projectId) {
    throw new McpAccessDeniedError("token_missing_project");
  }

  const [account] = await db
    .select({ banned: user.banned, banExpires: user.banExpires })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  // A ban that has expired no longer blocks the account; the row is read fresh, never taken from the token.
  if (!isCredentialOwnerActive(account)) throw new McpAccessDeniedError("user_unavailable");

  const [client] = await db.select({ disabled: oauthClient.disabled }).from(oauthClient)
    .where(eq(oauthClient.clientId, clientId)).limit(1);
  if (!client || client.disabled) throw new McpAccessDeniedError("client_unavailable");

  const [consent] = await db
    .select({ scopes: oauthConsent.scopes })
    .from(oauthConsent)
    .where(
      and(
        eq(oauthConsent.userId, userId),
        eq(oauthConsent.clientId, clientId),
        eq(oauthConsent.referenceId, projectId),
      ),
    )
    .limit(1);
  if (!consent || !consent.scopes.includes(MCP_READ_SCOPE)) {
    throw new McpAccessDeniedError("consent_revoked");
  }

  const permission = await resolveProjectPermissionContext(userId, projectId);
  if (!permission || !checkPermissionWithContext("project", "view", permission)) {
    throw new McpAccessDeniedError("no_project_access");
  }

  return {
    userId,
    clientId,
    organizationId: permission.organizationId,
    projectId,
    role: permission.project.userRole,
  };
}

/** RBAC resources an MCP tool may authorise against; every one must exist in the permission tables. */
export type McpViewResource =
  | "test"
  | "job"
  | "run"
  | "monitor"
  | "requirement"
  | "status_page"
  | "variable"
  | "sre_service"
  | "sre_incident"
  | "sre_investigation"
  | "project";

/** Per-tool check against the live role, on top of the project-level gate above. */
export function assertCanView(
  context: McpCallContext,
  resource: McpViewResource,
): void {
  const allowed = checkPermissionWithContext(resource, "view", {
    userId: context.userId,
    organizationId: context.organizationId,
    project: { id: context.projectId, userRole: context.role },
  });
  if (!allowed) throw new McpAccessDeniedError(`forbidden_${resource}`);
}
