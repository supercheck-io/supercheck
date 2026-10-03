import { NextRequest, NextResponse } from 'next/server';
import { getUserOrgRole } from '@/lib/rbac/middleware';
import { requireUserAuthContext, isAuthError } from '@/lib/auth-context';
import { db } from '@/utils/db';
import { organization, member, projects, session } from '@/db/schema';
import { eq, and, count } from 'drizzle-orm';
import { Role } from '@/lib/rbac/permissions';
import { z } from 'zod';
import { requireSameOriginRequest } from '@/lib/security/same-origin';
class OrganizationDeletionError extends Error {
  constructor(message: string, readonly status: 403 | 409) { super(message); }
}

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
    const { userId } = await requireUserAuthContext();
    const organizationId = resolvedParams.id;
    
    // Verify user is a member of this organization (implicit view permission)
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
        { status: 401 }
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
    const originError = requireSameOriginRequest(request, { allowMissing: isCliAuth });
    if (originError) return originError;
    const organizationId = resolvedParams.id;
    
    // Check permission using getUserOrgRole (works for both CLI tokens and session cookies)
    const orgRole = await getUserOrgRole(userId, organizationId);
    if (!orgRole) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }
    // Only ORG_ADMIN and ORG_OWNER can update organizations
    const canUpdate = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;
    if (!canUpdate) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    const body = await request.json();
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
      const firstError = nameValidation.error.errors[0];
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
        { status: 401 }
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
 * Delete organization (owner only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId, isCliAuth } = await requireUserAuthContext();
    const originError = requireSameOriginRequest(request, { allowMissing: isCliAuth });
    if (originError) return originError;
    const organizationId = resolvedParams.id;
    
    // Check permission - only owners can delete organizations
    // Uses getUserOrgRole which works for both CLI tokens and session cookies
    const orgRole = await getUserOrgRole(userId, organizationId);
    if (!orgRole) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }
    if (orgRole !== Role.ORG_OWNER) {
      return NextResponse.json(
        { error: 'Only organization owners can delete organizations' },
        { status: 403 }
      );
    }
    
    await db.transaction(async tx => {
      const [org] = await tx.select({ subscriptionId: organization.subscriptionId, polarCustomerId: organization.polarCustomerId })
        .from(organization).where(eq(organization.id, organizationId)).limit(1).for('update');
      if (!org) throw new OrganizationDeletionError('Organization not found', 409);
      // Recheck ownership inside the transaction and hold it during deletion.
      const [ownership] = await tx.select({ id: member.id }).from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId), eq(member.role, 'org_owner')))
        .limit(1).for('share');
      if (!ownership) throw new OrganizationDeletionError('Only organization owners can delete organizations', 403);
      if (org.subscriptionId || org.polarCustomerId) {
        throw new OrganizationDeletionError('Contact support to close a billing-linked organization. Deleting it here would not cancel billing.', 409);
      }
      const [project] = await tx.select({ id: projects.id }).from(projects)
        .where(eq(projects.organizationId, organizationId)).limit(1);
      if (project) {
        throw new OrganizationDeletionError('This organization contains projects. Contact your administrator or support for data removal before deleting it.', 409);
      }
      // Empty organizations may still be selected in browser sessions.
      await tx.update(session).set({ activeOrganizationId: null, activeProjectId: null })
        .where(eq(session.activeOrganizationId, organizationId));
      await tx.delete(organization).where(eq(organization.id, organizationId));
    });
    
    return NextResponse.json({
      success: true,
      message: 'Organization deleted successfully'
    });
    
  } catch (error) {
    if (error instanceof OrganizationDeletionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const databaseError = error as { code?: string; cause?: { code?: string } } | null;
    if (databaseError?.code === '23503' || databaseError?.cause?.code === '23503') {
      return NextResponse.json({ error: 'Related data prevents organization deletion. Contact your administrator or support for data removal.' }, { status: 409 });
    }
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Failed to delete organization:', error);
    return NextResponse.json(
      { error: 'Failed to delete organization' },
      { status: 500 }
    );
  }
}
