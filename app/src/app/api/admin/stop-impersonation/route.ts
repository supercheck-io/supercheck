import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { session } from '@/db/schema';
import { auth } from '@/utils/auth';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { logImpersonationEvent } from '@/lib/audit-logger';

export async function POST() {
  try {
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
  } catch (error) {
    console.error('Stop impersonation error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to stop impersonation' },
      { status: 500 }
    );
  }
}