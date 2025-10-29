import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers, requireAdmin } from '@/lib/admin';
import { createUserAsAdmin } from '@/utils/auth-client';
import { db } from '@/utils/db';
import { user } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/session';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    
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

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    
    const body = await request.json();
    const { name, email, password, role = 'user' } = body;
    
    if (!name || !email || !password) {
      return NextResponse.json(
        { success: false, error: 'Name, email, and password are required' },
        { status: 400 }
      );
    }
    
    // Use Better Auth admin client to create user
    const newUser = await createUserAsAdmin({
      name,
      email,
      password,
      role
    });
    
    // Set email as verified for admin-created users
    if ('user' in newUser && newUser.user && typeof newUser.user === 'object' && 'id' in newUser.user) {
      await db
        .update(user)
        .set({ emailVerified: true })
        .where(eq(user.id, newUser.user.id as string));
    }
    
    return NextResponse.json({
      success: true,
      data: newUser
    });
  } catch (error) {
    console.error('Admin users POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create user' },
      { status: 500 }
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
        if (currentUser?.id === userId) {
          return NextResponse.json(
            { success: false, error: 'You cannot ban yourself' },
            { status: 400 }
          );
        }
        
        // Use direct database update since we have our own RBAC admin check
        // Better Auth's admin plugin requires specific user IDs, but we use RBAC system
        const banExpires = duration ? new Date(Date.now() + duration) : null;
        
        await db
          .update(user)
          .set({
            banned: true,
            banReason: reason,
            banExpires: banExpires,
            updatedAt: new Date()
          })
          .where(eq(user.id, userId));

        result = { success: true, userId, action: 'banned', banReason: reason };
        break;
      
      case 'unban':
        // Use direct database update since we have our own RBAC admin check  
        // Better Auth's admin plugin requires specific user IDs, but we use RBAC system
        await db
          .update(user)
          .set({
            banned: false,
            banReason: null,
            banExpires: null,
            updatedAt: new Date()
          })
          .where(eq(user.id, userId));

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
      { status: 500 }
    );
  }
}