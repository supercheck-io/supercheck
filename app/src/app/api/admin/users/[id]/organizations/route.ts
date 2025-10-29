import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { member, organization } from '@/db/schema';
import { requireAdmin } from '@/lib/admin';
import { eq } from 'drizzle-orm';
import { roleToDisplayName, normalizeRole } from '@/lib/rbac/role-normalizer';

/**
 * GET /api/admin/users/[id]/organizations
 * Get all organizations that a user belongs to with their roles
 */
export async function GET(
  request: NextRequest, 
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    await requireAdmin();
    
    // Get user's organization memberships with organization details
    const userOrganizations = await db
      .select({
        organizationId: member.organizationId,
        organizationName: organization.name,
        role: member.role,
        joinedAt: member.createdAt
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, resolvedParams.id))
      .orderBy(member.id); // UUIDv7 is time-ordered (PostgreSQL 18+)
    
    // Normalize roles for consistent frontend handling
    const normalizedOrganizations = userOrganizations.map(org => ({
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: org.role, // Keep original for compatibility
      normalizedRole: normalizeRole(org.role), // Add normalized version
      displayRole: roleToDisplayName(normalizeRole(org.role)),
      joinedAt: org.joinedAt
    }));

    return NextResponse.json({
      success: true,
      organizations: normalizedOrganizations
    });
    
  } catch (error) {
    console.error('Failed to get user organizations:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch user organizations' 
      },
      { status: error instanceof Error && error.message === 'Admin privileges required' ? 403 : 500 }
    );
  }
}