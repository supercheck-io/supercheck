/**
 * Unified Authentication Context
 *
 * Provides project-scoped authentication for API routes, supporting both:
 * 1. Bearer token in Authorization header (CLI tokens: sck_live_*, sck_test_*)
 * 2. Session cookie (existing Better Auth flow from browser/dashboard)
 *
 * This is the primary auth middleware for all API routes that need project context.
 * It is a drop-in replacement for requireProjectContext() with added Bearer token support.
 *
 * CLI tokens are project-scoped API keys stored in the `apikey` table.
 * They carry the userId and projectId of the user who created them,
 * inheriting that user's RBAC permissions.
 */

import { headers } from "next/headers";
import { db } from "@/utils/db";
import { apikey, projects, member, projectMembers, organization } from "@/db/schema";
import { eq, and, isNull, or, gt } from "drizzle-orm";
import { verifyApiKey, isCliToken, getApiKeyPrefix } from "@/lib/security/api-key-hash";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { requireProjectContext, type ProjectContext } from "@/lib/project-context";
import { requireAuth as requireSessionAuth } from "@/lib/rbac/middleware";
import { getActiveOrganization } from "@/lib/session";
import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "auth-context" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

export interface AuthContext {
  userId: string;
  project: ProjectContext;
  organizationId: string;
  /** Organization name (available for CLI token auth) */
  organizationName?: string;
  /** Organization slug (available for CLI token auth) */
  organizationSlug?: string;
  /** Whether this request was authenticated via CLI token (vs session cookie) */
  isCliAuth: boolean;
}

/**
 * Custom error class for authentication failures.
 * Allows catch blocks to distinguish auth errors (401) from server errors (500).
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Check if an error is an authentication error thrown by requireAuthContext
 * or requireProjectContext. Matches both AuthError instances and known
 * message patterns from the session-based auth flow.
 */
export function isAuthError(error: unknown): boolean {
  if (error instanceof AuthError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("authentication required") ||
      msg.includes("invalid or expired cli token") ||
      msg.includes("invalid token type") ||
      msg.includes("authentication failed") ||
      msg.includes("no active project found")
    );
  }
  return false;
}

/**
 * Check if an error is a project-configuration error (missing/no project).
 * These should typically return 404 or 422, not 401.
 */
export function isProjectConfigError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("no active project found");
  }
  return false;
}

/**
 * Extract Bearer token from Authorization header.
 * Returns null if no Bearer token is present.
 */
async function getBearerToken(): Promise<string | null> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Authenticate a CLI token (sck_live_* or sck_test_*) and return auth context.
 *
 * The token is looked up in the `apikey` table using hash-based verification.
 * The token must:
 * - Be enabled
 * - Not be expired
 * - Have a projectId (CLI tokens are project-scoped)
 *
 * The returned context contains the token owner's userId, their project,
 * and the organization — exactly matching the shape from requireProjectContext().
 */
async function authenticateCliToken(token: string): Promise<AuthContext | null> {
  // Use the token's display prefix (stored in `start` column) to narrow candidates
  // instead of fetching ALL enabled CLI tokens across all projects/orgs
  const tokenStart = getApiKeyPrefix(token);

  const candidateKeys = await db
    .select({
      id: apikey.id,
      key: apikey.key,
      userId: apikey.userId,
      projectId: apikey.projectId,
      enabled: apikey.enabled,
      expiresAt: apikey.expiresAt,
    })
    .from(apikey)
    .where(
      and(
        eq(apikey.enabled, true),
        isNull(apikey.jobId),
        eq(apikey.start, tokenStart),
        // Exclude expired tokens at DB level to avoid unnecessary hash comparisons
        or(isNull(apikey.expiresAt), gt(apikey.expiresAt, new Date()))
      )
    );

  // Find matching key using constant-time hash comparison
  let matchedKey: (typeof candidateKeys)[0] | null = null;
  for (const key of candidateKeys) {
    if (verifyApiKey(token, key.key)) {
      matchedKey = key;
      break;
    }
  }

  if (!matchedKey) {
    logger.warn(
      { keyPrefix: token.substring(0, 12) },
      "Invalid CLI token attempted"
    );
    return null;
  }

  // CLI tokens must be project-scoped
  if (!matchedKey.projectId) {
    logger.warn(
      { keyId: matchedKey.id },
      "CLI token has no project scope"
    );
    return null;
  }

  // Fetch project + organization + user role in one query
  const contextResult = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      projectSlug: projects.slug,
      projectIsDefault: projects.isDefault,
      projectOrgId: projects.organizationId,
      orgName: organization.name,
      orgSlug: organization.slug,
      projectRole: projectMembers.role,
      orgRole: member.role,
    })
    .from(projects)
    .innerJoin(
      organization,
      eq(organization.id, projects.organizationId)
    )
    .leftJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.userId, matchedKey.userId)
      )
    )
    .leftJoin(
      member,
      and(
        eq(member.organizationId, projects.organizationId),
        eq(member.userId, matchedKey.userId)
      )
    )
    .where(eq(projects.id, matchedKey.projectId))
    .limit(1);

  const ctx = contextResult[0];
  if (!ctx) {
    logger.warn(
      { keyId: matchedKey.id, projectId: matchedKey.projectId },
      "CLI token references non-existent project"
    );
    return null;
  }

  // SECURITY: If user has been removed from both org and project, reject the token.
  // Without this check, normalizeRole(null) defaults to PROJECT_VIEWER, granting
  // read access to users who should have no access at all.
  if (!ctx.orgRole && !ctx.projectRole) {
    logger.warn(
      { keyId: matchedKey.id, userId: matchedKey.userId, projectId: matchedKey.projectId },
      "CLI token owner has no org or project membership — access denied"
    );
    return null;
  }

  // Determine the user's effective role (org role takes precedence)
  const effectiveRole = normalizeRole(ctx.orgRole ?? ctx.projectRole);

  // Update last request timestamp (best-effort, non-blocking for auth flow)
  try {
    await db.update(apikey)
      .set({ lastRequest: new Date() })
      .where(eq(apikey.id, matchedKey.id))
      .execute();
  } catch (err) {
    // Log but don't fail auth — this is a non-critical telemetry update
    logger.error({ err }, "Failed to update API key last request");
  }

  return {
    userId: matchedKey.userId,
    organizationId: ctx.projectOrgId,
    organizationName: ctx.orgName ?? undefined,
    organizationSlug: ctx.orgSlug ?? undefined,
    isCliAuth: true,
    project: {
      id: ctx.projectId,
      name: ctx.projectName ?? "Unknown Project",
      slug: ctx.projectSlug ?? undefined,
      organizationId: ctx.projectOrgId,
      isDefault: ctx.projectIsDefault ?? false,
      userRole: effectiveRole,
    },
  };
}

/**
 * Unified authentication for API routes.
 *
 * Accepts both CLI Bearer tokens and session cookies.
 * Returns the same AuthContext shape regardless of auth method.
 *
 * Usage (drop-in replacement for requireProjectContext):
 * ```typescript
 * const context = await requireAuthContext();
 * // context.userId, context.project, context.organizationId — same as before
 * // context.isCliAuth — true if authenticated via CLI token
 * ```
 */
export async function requireAuthContext(): Promise<AuthContext> {
  // 1. Check for Bearer token first (CLI auth)
  const bearerToken = await getBearerToken();

  if (bearerToken) {
    // Only process CLI tokens (sck_live_*, sck_test_*)
    // Trigger tokens (sck_trigger_*) should NOT be used for general API access
    if (!isCliToken(bearerToken)) {
      throw new AuthError(
        "Invalid token type. Use a CLI token (sck_live_* or sck_test_*) for API access. " +
        "Trigger tokens (sck_trigger_*) can only be used for job triggers."
      );
    }

    const cliContext = await authenticateCliToken(bearerToken);
    if (!cliContext) {
      throw new AuthError("Invalid or expired CLI token");
    }

    return cliContext;
  }

  // 2. Fall back to session-based auth (browser/dashboard)
  const sessionContext = await requireProjectContext();
  return {
    ...sessionContext,
    isCliAuth: false,
  };
}

/**
 * User-level authentication context (no project scope required).
 *
 * For org-level and user-level API routes (e.g. /api/organizations, /api/audit)
 * that need Bearer token support but do NOT require project context.
 */
export interface UserAuthContext {
  userId: string;
  /** Organization ID — from CLI token's project scope, or session's active org */
  organizationId: string | null;
  /** Whether this request was authenticated via CLI token (vs session cookie) */
  isCliAuth: boolean;
}

/**
 * Unified user-level authentication for API routes.
 *
 * Accepts both CLI Bearer tokens and session cookies, returning only userId
 * and organizationId — suitable for org-level routes that don't need project context.
 *
 * CLI path:  Bearer token → authenticateCliToken → extract userId + organizationId
 * Session path:  requireAuth (session) → getActiveOrganization → extract userId + orgId
 *
 * Usage:
 * ```typescript
 * const { userId, organizationId } = await requireUserAuthContext();
 * if (!organizationId) {
 *   return NextResponse.json({ error: 'No active organization found' }, { status: 400 });
 * }
 * ```
 */
export async function requireUserAuthContext(): Promise<UserAuthContext> {
  // 1. Check for Bearer token first (CLI auth)
  const bearerToken = await getBearerToken();

  if (bearerToken) {
    if (!isCliToken(bearerToken)) {
      throw new AuthError(
        "Invalid token type. Use a CLI token (sck_live_* or sck_test_*) for API access. " +
        "Trigger tokens (sck_trigger_*) can only be used for job triggers."
      );
    }

    const cliContext = await authenticateCliToken(bearerToken);
    if (!cliContext) {
      throw new AuthError("Invalid or expired CLI token");
    }

    return {
      userId: cliContext.userId,
      organizationId: cliContext.organizationId,
      isCliAuth: true,
    };
  }

  // 2. Fall back to session-based auth (browser/dashboard)
  const { userId } = await requireSessionAuth();
  const activeOrg = await getActiveOrganization();

  return {
    userId,
    organizationId: activeOrg?.id ?? null,
    isCliAuth: false,
  };
}
