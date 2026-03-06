import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import {
  user, session, apikey,
  tests, jobs, monitors, reports, tags,
  projectVariables,
  notificationProviders, notifications,
  statusPages, incidents, incidentUpdates, incidentTemplates, postmortems,
  auditLogs,
} from '@/db/schema';
import { requireAdmin } from '@/lib/admin';
import { getCurrentUser } from '@/lib/session';
import { auth } from '@/utils/auth';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { logImpersonationEvent } from '@/lib/audit-logger';
import { checkAdminRateLimit } from '@/lib/session-security';


export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    await requireAdmin();
    
    const [userData] = await db
      .select()
      .from(user)
      .where(eq(user.id, resolvedParams.id))
      .limit(1);
    
    if (!userData) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: userData
    });
  } catch (error) {
    console.error('Admin user GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch user' },
      { status: error instanceof Error && error.message === 'Admin privileges required' ? 403 : 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    await requireAdmin();
    
    const body = await request.json();
    const { name, email, role } = body;
    
    const [updatedUser] = await db
      .update(user)
      .set({
        name,
        email,
        role,
        updatedAt: new Date()
      })
      .where(eq(user.id, resolvedParams.id))
      .returning();
    
    if (!updatedUser) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: updatedUser
    });
  } catch (error) {
    console.error('Admin user PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update user' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    await requireAdmin();

    // Prevent self-deletion
    const currentAdmin = await getCurrentUser();
    if (currentAdmin && resolvedParams.id === currentAdmin.id) {
      return NextResponse.json(
        { success: false, error: 'Cannot delete your own account' },
        { status: 400 }
      );
    }

    // Verify user exists before attempting deletion
    const [targetUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, resolvedParams.id))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const userId = resolvedParams.id;

    await db.transaction(async (tx) => {
      // 1. Delete API keys (onDelete: "no action" would block user deletion)
      await tx.delete(apikey).where(eq(apikey.userId, userId));

      // 1b. Delete sessions where this user is the impersonating admin.
      // impersonatedBy is a text column (non-FK), so these rows would otherwise survive.
      // Deleting them prevents orphaned impersonation sessions after admin removal.
      await tx.delete(session).where(eq(session.impersonatedBy, userId));

      // 2. Nullify created_by_user_id references so owned resources persist
      await tx.update(tests).set({ createdByUserId: null }).where(eq(tests.createdByUserId, userId));
      await tx.update(jobs).set({ createdByUserId: null }).where(eq(jobs.createdByUserId, userId));
      await tx.update(monitors).set({ createdByUserId: null }).where(eq(monitors.createdByUserId, userId));
      await tx.update(reports).set({ createdByUserId: null }).where(eq(reports.createdByUserId, userId));
      await tx.update(tags).set({ createdByUserId: null }).where(eq(tags.createdByUserId, userId));
      await tx.update(notificationProviders).set({ createdByUserId: null }).where(eq(notificationProviders.createdByUserId, userId));
      await tx.update(statusPages).set({ createdByUserId: null }).where(eq(statusPages.createdByUserId, userId));
      await tx.update(incidents).set({ createdByUserId: null }).where(eq(incidents.createdByUserId, userId));
      await tx.update(incidentUpdates).set({ createdByUserId: null }).where(eq(incidentUpdates.createdByUserId, userId));
      await tx.update(incidentTemplates).set({ createdByUserId: null }).where(eq(incidentTemplates.createdByUserId, userId));
      await tx.update(postmortems).set({ createdByUserId: null }).where(eq(postmortems.createdByUserId, userId));
      await tx.update(projectVariables).set({ createdByUserId: null }).where(eq(projectVariables.createdByUserId, userId));

      // 3. Delete notifications and audit logs owned by the user
      await tx.delete(notifications).where(eq(notifications.userId, userId));
      await tx.delete(auditLogs).where(eq(auditLogs.userId, userId));

      // 4. Delete user — CASCADE handles: session, account, member,
      //    project_members, invitation.inviterId
      await tx.delete(user).where(eq(user.id, userId));
    });
    
    return NextResponse.json({
      success: true,
      data: { message: 'User deleted successfully' }
    });
  } catch (error) {
    console.error('Admin user DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    await requireAdmin();
    
    const body = await request.json();
    const { action, organizationId } = body;
    
    if (action === 'impersonate') {
      // Get current admin session
      const sessionData = await auth.api.getSession({
        headers: await headers(),
      });
      
      if (!sessionData?.session?.id) {
        return NextResponse.json(
          { success: false, error: 'No active session' },
          { status: 401 }
        );
      }

      // Prevent super admins from impersonating themselves
      if (sessionData.user.id === resolvedParams.id) {
        return NextResponse.json(
          { success: false, error: 'You cannot impersonate yourself' },
          { status: 400 }
        );
      }

      // Rate limiting for impersonation operations (max 20 per 5 minutes)
      const rateLimitCheck = await checkAdminRateLimit(sessionData.user.id, 'impersonate', 20);
      if (!rateLimitCheck.allowed) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Rate limit exceeded for impersonation operations',
            resetTime: rateLimitCheck.resetTime 
          },
          { status: 429 }
        );
      }

      // Verify target user exists
      const [targetUser] = await db
        .select()
        .from(user)
        .where(eq(user.id, resolvedParams.id))
        .limit(1);
      
      if (!targetUser) {
        return NextResponse.json(
          { success: false, error: 'Target user not found' },
          { status: 404 }
        );
      }

      // Note: We don't create defaults during impersonation
      // This allows admins to impersonate invited users without creating unwanted organizations

      // Update session to impersonate the target user
      // Store the original user ID in impersonatedBy field and optionally set organization context
      await db
        .update(session)
        .set({
          userId: targetUser.id,
          impersonatedBy: sessionData.user.id,
          activeOrganizationId: organizationId || null, // Set specific organization if provided
          activeProjectId: null, // Clear project context to force default project selection
          updatedAt: new Date()
        })
        .where(eq(session.token, sessionData.session.token));
      
      // Log the impersonation event for audit trail
      await logImpersonationEvent(
        sessionData.user.id,
        targetUser.id,
        'start',
        {
          targetUserName: targetUser.name,
          targetUserEmail: targetUser.email,
          sessionToken: sessionData.session.token.substring(0, 8) + '...' // Log only partial token for security
        }
      );
      
      return NextResponse.json({
        success: true,
        data: {
          message: `Now impersonating ${targetUser.name}`,
          impersonatedUser: {
            id: targetUser.id,
            name: targetUser.name,
            email: targetUser.email
          }
        }
      });
    }
    
    if (action === 'stop-impersonation') {
      // Get current session
      const sessionData = await auth.api.getSession({
        headers: await headers(),
      });
      
      if (!sessionData?.session?.id) {
        return NextResponse.json(
          { success: false, error: 'No active session' },
          { status: 401 }
        );
      }

      // Get current session data to find original user
      const [currentSession] = await db
        .select()
        .from(session)
        .where(eq(session.token, sessionData.session.token))
        .limit(1);

      if (!currentSession?.impersonatedBy) {
        return NextResponse.json(
          { success: false, error: 'Not currently impersonating' },
          { status: 400 }
        );
      }

      // Log the stop impersonation event before restoring session
      await logImpersonationEvent(
        currentSession.impersonatedBy,
        currentSession.userId,
        'stop',
        {
          sessionToken: sessionData.session.token.substring(0, 8) + '...' // Log only partial token for security
        }
      );

      // Query admin's original organization context from their most recent non-impersonated session
      // This allows us to restore the admin to their original context (security fix)
      const [adminSession] = await db
        .select({ activeOrganizationId: session.activeOrganizationId })
        .from(session)
        .where(eq(session.userId, currentSession.impersonatedBy))
        .limit(1);

      // Restore original user session with admin's org context
      // This ensures the admin returns to their correct organization context
      await db
        .update(session)
        .set({
          userId: currentSession.impersonatedBy,
          impersonatedBy: null,
          activeOrganizationId: adminSession?.activeOrganizationId || null, // Restore admin's org context
          activeProjectId: null, // Clear project context to force admin's default project
          updatedAt: new Date()
        })
        .where(eq(session.token, sessionData.session.token));
      
      return NextResponse.json({
        success: true,
        data: {
          message: 'Impersonation stopped, returned to admin account'
        }
      });
    }
    
    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Admin user POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to perform action' },
      { status: 500 }
    );
  }
}