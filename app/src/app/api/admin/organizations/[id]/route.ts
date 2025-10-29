import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { organization, member, projects, user } from '@/db/schema';
import { requireAdmin } from '@/lib/admin';
import { eq, count } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    await requireAdmin();
    
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
    
    const body = await request.json();
    const { name, slug, logo, metadata } = body;
    
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
    console.error('Admin organization PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update organization' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    await requireAdmin();
    
    // First check if organization exists and get member count
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
    
    await db
      .delete(organization)
      .where(eq(organization.id, resolvedParams.id));
    
    return NextResponse.json({
      success: true,
      data: { message: 'Organization deleted successfully' }
    });
  } catch (error) {
    console.error('Admin organization DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete organization' },
      { status: 500 }
    );
  }
}