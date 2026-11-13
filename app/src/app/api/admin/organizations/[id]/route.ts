import { isUuid } from "@/lib/uuid";
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { organization, member, projects, user } from '@/db/schema';
import { requireAdmin } from '@/lib/admin';
import { adminDeniedResponse } from '@/lib/admin-errors';
import { getCurrentUser } from '@/lib/session';
import { logAdminEvent } from '@/lib/audit-logger';
import { OrganizationMembershipChangedError, requestOrganizationDeletion } from '@/lib/deletion/organization';
import { isImpersonatedSession } from '@/lib/rbac/middleware';
import { checkAdminRateLimit } from '@/lib/session-security';
import { eq, count } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    await requireAdmin();
    
    if (!isUuid((await params).id)) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    const [orgData] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, resolvedParams.id))
      .limit(1);
    
    if (!orgData) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }
    
    // Get detailed stats for this organization
    const [memberCountResult] = await db
      .select({ count: count() })
      .from(member)
      .where(eq(member.organizationId, resolvedParams.id));
    
    const [projectCountResult] = await db
      .select({ count: count() })
      .from(projects)
      .where(eq(projects.organizationId, resolvedParams.id));
    
    // Get organization members with user details
    const members = await db
      .select({
        id: member.id,
        role: member.role,
        createdAt: member.createdAt,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image
        }
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, resolvedParams.id));
    
    // Get organization projects
    const orgProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.organizationId, resolvedParams.id));
    
    return NextResponse.json({
      success: true,
      data: {
        ...orgData,
        memberCount: memberCountResult.count,
        projectCount: projectCountResult.count,
        members,
        projects: orgProjects
      }
    });
  } catch (error) {
    const denied = adminDeniedResponse(error);
    if (denied) return denied;
    console.error('Admin organization GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch organization' },
      { status: error instanceof Error && error.message === 'Admin privileges required' ? 403 : 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    await requireAdmin();
    
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { name, slug, logo, metadata } = body;
    
    if (!isUuid((await params).id)) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    const [updatedOrg] = await db
      .update(organization)
      .set({
        name,
        slug,
        logo,
        metadata
      })
      .where(eq(organization.id, resolvedParams.id))
      .returning();
    
    if (!updatedOrg) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: updatedOrg
    });
  } catch (error) {
    const denied = adminDeniedResponse(error);
    if (denied) return denied;
    console.error('Admin organization PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update organization' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    await requireAdmin();
    const admin = await getCurrentUser();
    if (!admin) throw new Error('Authentication required');
    if (await isImpersonatedSession()) {
      return NextResponse.json({ success: false, error: 'Stop impersonating before deleting organizations' }, { status: 403 });
    }
    const deleteLimit = await checkAdminRateLimit(admin.id, 'delete_organization', 10, 10 * 60 * 1000);
    if (!deleteLimit.allowed) {
      return NextResponse.json({ success: false, error: 'Too many deletions. Try again later.' }, { status: 429 });
    }
    
    // First check if organization exists and get member count
    if (!isUuid((await params).id)) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    const [orgData] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, resolvedParams.id))
      .limit(1);
    
    if (!orgData) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      );
    }
    
    const [memberCountResult] = await db
      .select({ count: count() })
      .from(member)
      .where(eq(member.organizationId, resolvedParams.id));
    
    if (memberCountResult.count > 0) {
      return NextResponse.json(
        { success: false, error: 'Cannot delete organization with members' },
        { status: 400 }
      );
    }
    
    // The caller must name the organization it confirmed (no blind or replayed teardown).
    const body = (await request.json().catch(() => ({}))) as { confirmOrganizationId?: unknown };
    if (body.confirmOrganizationId !== resolvedParams.id) {
      return NextResponse.json(
        { success: false, error: 'Confirm the organization to delete (confirmOrganizationId)' },
        { status: 400 }
      );
    }

    // Same path as the owner flow: a pending window (not an immediate teardown). Super admins can purge early via /purge.
    try {
      const result = await requestOrganizationDeletion({ organizationId: resolvedParams.id, actorUserId: admin.id, guard: { noMembers: true }, reason: 'admin' });
      if (result) {
        try {
          await logAdminEvent(admin.id, 'organization_deletion_requested', resolvedParams.id, 'organization', resolvedParams.id, {
            organizationName: orgData.name, purgeAfter: result.purgeAfter.toISOString(), billing: result.billing,
          });
        } catch (error) {
          console.error('Failed to audit organization deletion:', error);
        }
        return NextResponse.json({ success: true, data: { message: 'Organization scheduled for deletion', status: result.status, purgeAfter: result.purgeAfter, billing: result.billing } });
      }
    } catch (error) {
      if (error instanceof OrganizationMembershipChangedError) {
        return NextResponse.json({ success: false, error: 'Cannot delete organization with members' }, { status: 400 });
      }
      throw error;
    }
    return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 404 });
  } catch (error) {
    const denied = adminDeniedResponse(error);
    if (denied) return denied;
    console.error('Admin organization DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete organization' },
      { status: 500 }
    );
  }
}
