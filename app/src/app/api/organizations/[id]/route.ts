import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, hasPermission } from '@/lib/rbac/middleware';
import { db } from '@/utils/db';
import { organization, member, projects } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

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
    const { userId } = await requireAuth();
    const organizationId = resolvedParams.id;
    
    // Check permission
    const canView = await hasPermission('organization', 'view', {
      organizationId
    });
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // Get organization details
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
    
    // Get projects count
    const projectCount = await db
      .select({ count: projects.id })
      .from(projects)
      .where(eq(projects.organizationId, organizationId));
    
    // Get members count
    const memberCount = await db
      .select({ count: member.id })
      .from(member)
      .where(eq(member.organizationId, organizationId));
    
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
          projectCount: projectCount.length,
          memberCount: memberCount.length
        }
      }
    });
    
  } catch (error) {
    console.error('Failed to get organization:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Organization not found or access denied' },
          { status: 404 }
        );
      }
    }
    
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
    await requireAuth();
    const organizationId = resolvedParams.id;
    
    // Check permission (using 'update' action - 'manage' doesn't exist for organization)
    const canUpdate = await hasPermission('organization', 'update', {
      organizationId
    });
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
    console.error('Failed to update organization:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Organization not found or access denied' },
          { status: 404 }
        );
      }
    }
    
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
    await requireAuth();
    const organizationId = resolvedParams.id;
    
    // Check permission - only owners can delete organizations
    const canDelete = await hasPermission('organization', 'delete', {
      organizationId
    });
    if (!canDelete) {
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
    console.error('Failed to delete organization:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Organization not found or access denied' },
          { status: 404 }
        );
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to delete organization' },
      { status: 500 }
    );
  }
}