import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { projects, jobs, tests, monitors, runs, member } from '@/db/schema';
import { count, eq } from 'drizzle-orm';
import { getUserOrgRole } from '@/lib/rbac/middleware';
import { requireUserAuthContext, isAuthError } from '@/lib/auth-context';
import { Role } from '@/lib/rbac/permissions';

export async function GET() {
  try {
    const { userId, organizationId } = await requireUserAuthContext();
    
    if (!organizationId) {
      return NextResponse.json(
        { error: 'No active organization found' },
        { status: 400 }
      );
    }

    // Check if user is org admin
    const orgRole = await getUserOrgRole(userId, organizationId);
    const isOrgAdmin = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;
    
    if (!isOrgAdmin) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Get organization stats
    const [
      projectsCount,
      jobsCount,
      testsCount,
      monitorsCount,
      runsCount,
      membersCount
    ] = await Promise.all([
      db.select({ count: count() }).from(projects).where(eq(projects.organizationId, organizationId)),
      db.select({ count: count() }).from(jobs).where(eq(jobs.organizationId, organizationId)),
      db.select({ count: count() }).from(tests).where(eq(tests.organizationId, organizationId)),
      db.select({ count: count() }).from(monitors).where(eq(monitors.organizationId, organizationId)),
      db.select({ count: count() }).from(runs)
        .leftJoin(jobs, eq(runs.jobId, jobs.id))
        .where(eq(jobs.organizationId, organizationId)),
      db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId))
    ]);

    const stats = {
      projects: projectsCount[0]?.count || 0,
      jobs: jobsCount[0]?.count || 0,
      tests: testsCount[0]?.count || 0,
      monitors: monitorsCount[0]?.count || 0,
      runs: runsCount[0]?.count || 0,
      members: membersCount[0]?.count || 0,
    };

    return NextResponse.json({
      success: true,
      data: stats
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error fetching organization stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization stats' },
      { status: 500 }
    );
  }
}