import { NextRequest, NextResponse } from 'next/server';
import { updateOrganizationNameSchema } from '@/lib/validations/organization';
import { requireUserAuthContext, isAuthError } from '@/lib/auth-context';
import { getSelectableOrganizations } from '@/lib/session';
import { requireSameOriginRequest } from '@/lib/security/same-origin';
import { createOrganization, OrganizationManagementError } from '@/lib/services/organization-management';

/**
 * GET /api/organizations
 * Return selectable organizations and the active selection
 */
export async function GET() {
  try {
    const { userId, organizationId, isCliAuth } = await requireUserAuthContext();
    
    const userOrganizations = await getSelectableOrganizations(userId);
    
    return NextResponse.json({
      success: true,
      data: userOrganizations.filter(org => !isCliAuth || org.id === organizationId)
        .map(org => ({ ...org, isActive: org.id === organizationId })),
      activeOrganizationId: organizationId,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Failed to get organizations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organizations' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/organizations
 * Compatibility endpoint: additional organization creation is disabled.
 */
export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;
  const parsed = updateOrganizationNameSchema.strict()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Enter an organization name between 2 and 50 characters' }, { status: 400 });
  try {
    const data = await createOrganization(parsed.data.name);
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    if (error instanceof OrganizationManagementError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to create organization:', error);
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}
