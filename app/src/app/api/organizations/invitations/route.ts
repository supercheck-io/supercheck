import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { invitation, user as userTable } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
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
      .where(eq(invitation.organizationId, organizationId))
      .orderBy(desc(invitation.expiresAt));

    return NextResponse.json({
      success: true,
      data: invitations
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error fetching invitations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invitations' },
      { status: 500 }
    );
  }
}