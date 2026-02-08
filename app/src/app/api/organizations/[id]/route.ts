import { NextRequest, NextResponse } from 'next/server';
import { getUserOrgRole } from '@/lib/rbac/middleware';
import { requireUserAuthContext, isAuthError } from '@/lib/auth-context';
import { db } from '@/utils/db';
import { organization, member, projects } from '@/db/schema';
import { eq, and, count } from 'drizzle-orm';
import { Role } from '@/lib/rbac/permissions';

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
    const { userId } = await requireUserAuthContext();
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
    const { name, slug, logo, metadata } = body;
    
    if (!name) {
      return NextResponse.json(
        { error: 'Organization name is required' },
        { status: 400 }
      );
    }
    
    // Update organization
    const [updatedOrg] = await db
      .update(organization)
      .set({
        name,
        slug: slug || null,
        logo: logo || null,
        metadata: metadata || null
      })
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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const { userId } = await requireUserAuthContext();
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
    
    // Delete organization (CASCADE will handle related records)
    await db
      .delete(organization)
      .where(eq(organization.id, organizationId));
    
    return NextResponse.json({
      success: true,
      message: 'Organization deleted successfully'
    });
    
  } catch (error) {
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