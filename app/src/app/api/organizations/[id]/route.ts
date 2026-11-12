import { isUuid } from "@/lib/uuid";
import { NextRequest, NextResponse } from 'next/server';
import { getUserOrgRole } from '@/lib/rbac/middleware';
import { requireUserAuthContext, isAuthError, authErrorStatus } from '@/lib/auth-context';
import { db } from '@/utils/db';
import { organization, member, projects, session } from '@/db/schema';
import { eq, and, count } from 'drizzle-orm';
import { Role } from '@/lib/rbac/permissions';
import { z } from 'zod';
import { OrganizationMembershipChangedError, requestOrganizationDeletion } from '@/lib/deletion/organization';
import { isFreshSession, reauthRequiredResponse } from '@/lib/deletion/reauth';
import { isImpersonatedSession } from '@/lib/rbac/middleware';
import { checkAdminRateLimit } from '@/lib/session-security';
import { requireSameOriginRequest } from '@/lib/security/same-origin';

import { isOrgPendingDeletion, pendingDeletionResponse, permissionDeniedResponse } from "@/lib/deletion/org-state";
/**
 * Validation schema for organization name updates.
 * Matches the client-side schema in lib/validations/organization.ts.
 * trim() is applied first so whitespace-only strings are rejected by min(2).
 */
const updateOrgNameSchema = z.object({
  name: z.string().trim().min(2).max(50),
});

/**
 * GET /api/organizations/[id]
 * Get organization details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) {
      return NextResponse.json({ error: "Organization administration requires an interactive browser session; CLI tokens are project-scoped" }, { status: 403 });
    }
    const organizationId = resolvedParams.id;
    
    // Verify user is a member of this organization (implicit view permission)
    if (!isUuid((await params).id)) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    const orgData = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        createdAt: organization.createdAt,
        metadata: organization.metadata,
        userRole: member.role
      })
      .from(organization)
      .innerJoin(member, eq(member.organizationId, organization.id))
      .where(and(
        eq(organization.id, organizationId),
        eq(member.userId, userId)
      ))
      .limit(1);
    
    if (orgData.length === 0) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }
    
    const org = orgData[0];
    
    // Get projects count and members count using SQL count() aggregate
    const [projectCountResult, memberCountResult] = await Promise.all([
      db.select({ count: count() }).from(projects).where(eq(projects.organizationId, organizationId)),
      db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
    ]);
    
    return NextResponse.json({
      success: true,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        createdAt: org.createdAt,
        metadata: org.metadata,
        role: org.userRole,
        stats: {
          projectCount: projectCountResult[0]?.count || 0,
          memberCount: memberCountResult[0]?.count || 0
        }
      }
    });
    
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: authErrorStatus(error) }
      );
    }
    console.error('Failed to get organization:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/organizations/[id]
 * Update organization details
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) {
      return NextResponse.json({ error: "Organization administration requires an interactive browser session; CLI tokens are project-scoped" }, { status: 403 });
    }
    const originError = requireSameOriginRequest(request, { allowMissing: isCliAuth });
    if (originError) return originError;
    const organizationId = resolvedParams.id;
    
    // Check permission using getUserOrgRole (works for both CLI tokens and session cookies)
    if (!isUuid((await params).id)) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    const orgRole = await getUserOrgRole(userId, organizationId);
    if (!orgRole) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }
    if (await isOrgPendingDeletion(organizationId, { fresh: true })) return pendingDeletionResponse();
    // Only ORG_ADMIN and ORG_OWNER can update organizations
    const canUpdate = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;
    if (!canUpdate) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { name } = body;
    
    if (!name) {
      return NextResponse.json(
        { error: 'Organization name is required' },
        { status: 400 }
      );
    }

    // Validate organization name
    const nameValidation = updateOrgNameSchema.safeParse({ name });
    if (!nameValidation.success) {
      const firstError = nameValidation.error.issues[0];
      return NextResponse.json(
        { error: firstError?.message || 'Invalid organization name' },
        { status: 400 }
      );
    }

    const updateData: {
      name: string;
      slug?: string | null;
      logo?: string | null;
      metadata?: unknown;
    } = {
      name: nameValidation.data.name,
    };

    if (Object.prototype.hasOwnProperty.call(body, 'slug')) {
      const rawSlug = body.slug;
      updateData.slug = typeof rawSlug === 'string' && rawSlug.trim() ? rawSlug : null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'logo')) {
      const rawLogo = body.logo;
      updateData.logo = typeof rawLogo === 'string' && rawLogo.trim() ? rawLogo : null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'metadata')) {
      updateData.metadata = body.metadata ?? null;
    }
    
    // Update organization
    const [updatedOrg] = await db
      .update(organization)
      .set(updateData)
      .where(eq(organization.id, organizationId))
      .returning();
    
    if (!updatedOrg) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      organization: updatedOrg
    });
    
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: authErrorStatus(error) }
      );
    }
    console.error('Failed to update organization:', error);
    return NextResponse.json(
      { error: 'Failed to update organization' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/organizations/[id]
 * Request deletion (owner only). Never immediate: the organization turns read-only for a grace window (default 14 days,
 * ORG_DELETION_GRACE_DAYS) during which the owner can cancel; only then is it purged. Body: { confirmName } = the exact
 * organization name. Requires a session created within the last few minutes (403 REAUTH_REQUIRED otherwise).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) {
      return NextResponse.json({ error: "Organization administration requires an interactive browser session; CLI tokens are project-scoped" }, { status: 403 });
    }
    const originError = requireSameOriginRequest(request, { allowMissing: isCliAuth });
    if (originError) return originError;
    const organizationId = resolvedParams.id;

    if (!isUuid(organizationId)) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    const orgRole = await getUserOrgRole(userId, organizationId);
    if (!orgRole) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (orgRole !== Role.ORG_OWNER) {
      return NextResponse.json({ error: 'Only organization owners can delete organizations' }, { status: 403 });
    }

    // Never from an impersonated session (an impersonation session is always "fresh"), rate limited.
    if (await isImpersonatedSession()) {
      return NextResponse.json({ error: 'Stop impersonating before deleting an organization' }, { status: 403 });
    }
    const limit = await checkAdminRateLimit(userId, 'delete_own_organization', 5, 10 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }
    const body = ((await request.json().catch(() => null)) ?? {}) as { confirmName?: unknown };
    const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, organizationId)).limit(1);
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    if (typeof body.confirmName !== 'string' || body.confirmName.trim() !== org.name.trim()) {
      return NextResponse.json({ error: 'Type the organization name exactly to confirm', code: 'CONFIRM_NAME_MISMATCH' }, { status: 400 });
    }
    if (!(await isFreshSession())) return reauthRequiredResponse();

    try {
      const result = await requestOrganizationDeletion({ organizationId, actorUserId: userId, guard: { ownerUserId: userId }, reason: 'owner' });
      if (!result) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      return NextResponse.json({
        success: true,
        status: result.status,
        purgeAfter: result.purgeAfter,
        // "retry": the subscription cancellation at the provider failed and is retried automatically.
        billing: result.billing,
        message: 'Organization scheduled for deletion',
      });
    } catch (error) {
      if (error instanceof OrganizationMembershipChangedError) {
        return NextResponse.json({ error: 'Only organization owners can delete organizations' }, { status: 403 });
      }
      const code = (error as { code?: string; cause?: { code?: string } } | null);
      if (code?.code === '55P03' || code?.cause?.code === '55P03') {
        return NextResponse.json({ error: 'The organization is busy. Try again in a moment.' }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: authErrorStatus(error) }
      );
    }
    console.error('Failed to request organization deletion:', error);
    return NextResponse.json({ error: 'Failed to request organization deletion' }, { status: 500 });
  }
}
