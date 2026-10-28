import { suspendAccount } from "@/lib/security/suspend-account";
import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers, requireAdmin } from '@/lib/admin';
import { db } from '@/utils/db';
import { user } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/session';
import { logAdminEvent } from '@/lib/audit-logger';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50') || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0') || 0, 0);
    
    const users = await getAllUsers(limit, offset);
    
    return NextResponse.json({
      success: true,
      data: users,
      pagination: {
        limit,
        offset,
        hasMore: users.length === limit
      }
    });
  } catch (error) {
    console.error('Admin users GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch users' },
      { status: error instanceof Error && error.message === 'Admin privileges required' ? 403 : 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
    
    const body = await request.json();
    const { userId, action, reason, duration } = body;
    
    if (!userId || !action) {
      return NextResponse.json(
        { success: false, error: 'User ID and action are required' },
        { status: 400 }
      );
    }
    
    let result;
    
    switch (action) {
      case 'ban':
        if (!reason) {
          return NextResponse.json(
            { success: false, error: 'Ban reason is required' },
            { status: 400 }
          );
        }
        
        // Prevent super admins from banning themselves
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          return NextResponse.json(
            { success: false, error: 'Not authenticated' },
            { status: 401 }
          );
        }
        if (currentUser.id === userId) {
          return NextResponse.json(
            { success: false, error: 'You cannot ban yourself' },
            { status: 400 }
          );
        }
        
        // Use direct database update since we have our own RBAC admin check
        // Better Auth's admin plugin requires specific user IDs, but we use RBAC system
        // 0 or no duration means a permanent ban; a negative one would be an already-expired, silent no-op.
        if (duration !== undefined && duration !== null && !(Number.isFinite(duration) && duration >= 0)) {
          return NextResponse.json(
            { success: false, error: 'Ban duration must be a non-negative number of milliseconds' },
            { status: 400 }
          );
        }
        const banExpires = duration ? new Date(Date.now() + duration) : null;
        
        await suspendAccount(userId, reason, banExpires);

        // Audit log the ban action
        await logAdminEvent(
          currentUser.id,
          'user_banned',
          userId,
          'user',
          userId,
          { reason, duration, banExpires }
        );

        result = { success: true, userId, action: 'banned', banReason: reason, sessionsInvalidated: true };
        break;
      
      case 'unban':
        // Use direct database update since we have our own RBAC admin check  
        // Better Auth's admin plugin requires specific user IDs, but we use RBAC system
        const [unbanned] = await db
          .update(user)
          .set({
            banned: false,
            banReason: null,
            banExpires: null,
            updatedAt: new Date()
          })
          .where(eq(user.id, userId))
          .returning({ id: user.id });
        if (!unbanned) {
          return NextResponse.json(
            { success: false, error: 'User not found' },
            { status: 404 }
          );
        }
        await logAdminEvent((await getCurrentUser())?.id ?? 'unknown', 'user_unbanned', userId, 'user', userId);

        result = { success: true, userId, action: 'unbanned' };
        break;
      
      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Admin users PATCH error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update user' },
      { status: error instanceof Error && error.message === 'Admin privileges required' ? 403 : 500 }
    );
  }
}