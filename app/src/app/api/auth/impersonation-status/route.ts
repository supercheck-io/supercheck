import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { session, user } from '@/db/schema';
import { auth } from '@/utils/auth';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    // Get current session
    const sessionData = await auth.api.getSession({
      headers: await headers(),
    });
    
    if (!sessionData?.session?.id) {
      return NextResponse.json({
        isImpersonating: false
      });
    }

    // Get session details from database
    const [currentSession] = await db
      .select()
      .from(session)
      .where(eq(session.token, sessionData.session.token))
      .limit(1);

    if (!currentSession?.impersonatedBy) {
      return NextResponse.json({
        isImpersonating: false
      });
    }

    // Get details of both users
    const [impersonatedUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, currentSession.userId))
      .limit(1);

    const [originalAdmin] = await db
      .select()
      .from(user)
      .where(eq(user.id, currentSession.impersonatedBy))
      .limit(1);

    return NextResponse.json({
      isImpersonating: true,
      impersonatedUser: impersonatedUser ? {
        id: impersonatedUser.id,
        name: impersonatedUser.name,
        email: impersonatedUser.email
      } : null,
      originalAdmin: originalAdmin ? {
        id: originalAdmin.id,
        name: originalAdmin.name,
        email: originalAdmin.email
      } : null
    });
  } catch (error) {
    console.error('Error checking impersonation status:', error);
    return NextResponse.json({
      isImpersonating: false
    });
  }
}