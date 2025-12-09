import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { user, session } from '@/db/schema';
import { requireAdmin } from '@/lib/admin';
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
    
    const [deletedUser] = await db
      .delete(user)
      .where(eq(user.id, resolvedParams.id))
      .returning();
    
    if (!deletedUser) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }
    
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

      // Restore original user session and clear project context
      // This forces the admin to get their own project context back
      await db
        .update(session)
        .set({
          userId: currentSession.impersonatedBy,
          impersonatedBy: null,
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