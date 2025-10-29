import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { projectMembers, projects } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '@/lib/rbac/middleware';
import { getActiveOrganization, getCurrentUser } from '@/lib/session';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const resolvedParams = await params;
  try {
    await requireAuth();
    const currentUser = await getCurrentUser();
    const activeOrg = await getActiveOrganization();
    
    if (!currentUser || !activeOrg) {
      return NextResponse.json(
        { error: 'No active organization found' },
        { status: 400 }
      );
    }

    // Get project assignments for the specific user in the active organization
    const userProjectAssignments = await db
      .select({
        projectId: projectMembers.projectId,
        role: projectMembers.role,
        projectName: projects.name,
        projectDescription: projects.description
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(
        and(
          eq(projectMembers.userId, resolvedParams.userId),
          eq(projects.organizationId, activeOrg.id)
        )
      );

    return NextResponse.json({
      success: true,
      projects: userProjectAssignments
    });
  } catch (error) {
    console.error('Error fetching user project assignments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project assignments' },
      { status: 500 }
    );
  }
}