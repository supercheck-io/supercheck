import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/rbac/middleware';
import { getUserOrganizations } from '@/lib/session';

/**
 * GET /api/organizations
 * List all organizations for the current user
 */
export async function GET() {
  try {
    const { userId } = await requireAuth();
    
    const userOrganizations = await getUserOrganizations(userId);
    
    return NextResponse.json({
      success: true,
      data: userOrganizations
    });
  } catch (error) {
    console.error('Failed to get organizations:', error);
    
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to fetch organizations' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/organizations
 * Organization creation is disabled - organizations are created automatically on user signup
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Manual organization creation is not allowed. Organizations are created automatically on user signup.' },
    { status: 403 }
  );
}