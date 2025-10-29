import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { member, user as userTable, invitation } from '@/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { requireAuth } from '@/lib/rbac/middleware';
import { getActiveOrganization, getCurrentUser } from '@/lib/session';
import { getUserOrgRole } from '@/lib/rbac/middleware';
import { Role } from '@/lib/rbac/permissions';

export async function GET() {
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

    // Check if user is org admin
    const orgRole = await getUserOrgRole(currentUser.id, activeOrg.id);
    const isOrgAdmin = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;
    
    if (!isOrgAdmin) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Get organization members
    const members = await db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        role: member.role,
        joinedAt: member.createdAt
      })
      .from(member)
      .innerJoin(userTable, eq(member.userId, userTable.id))
      .where(eq(member.organizationId, activeOrg.id))
      .orderBy(desc(member.id)); // UUIDv7 is time-ordered (PostgreSQL 18+)

    // Members fetched successfully

    // Get pending invitations for this organization
    const invitations = await db
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        inviterName: userTable.name,
        inviterEmail: userTable.email
      })
      .from(invitation)
      .innerJoin(userTable, eq(invitation.inviterId, userTable.id))
      .where(eq(invitation.organizationId, activeOrg.id))
      .orderBy(desc(invitation.expiresAt));

    // Get current user's role in the organization
    const currentUserRole = await db
      .select({ role: member.role })
      .from(member)
      .where(and(
        eq(member.userId, currentUser.id),
        eq(member.organizationId, activeOrg.id)
      ))
      .limit(1);

    return NextResponse.json({
      success: true,
      data: {
        members,
        invitations,
        currentUserRole: currentUserRole[0]?.role || 'project_viewer'
      }
    });
  } catch (error) {
    console.error('Error fetching organization members:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization members' },
      { status: 500 }
    );
  }
}