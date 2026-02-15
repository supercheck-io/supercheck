import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { requirements, requirementTags, tags } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError } from '@/lib/auth-context';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await requireAuthContext();
    const { project, organizationId } = context;

    // Check permission to view requirements
    const canView = checkPermissionWithContext('requirement', 'view', context);

    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const { id: requirementId } = await params;

    // Verify requirement exists and belongs to current org/project
    const requirement = await db
      .select({ id: requirements.id })
      .from(requirements)
      .where(and(
        eq(requirements.id, requirementId),
        eq(requirements.organizationId, organizationId),
        eq(requirements.projectId, project.id)
      ))
      .limit(1);

    if (requirement.length === 0) {
      return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
    }

    // Get tags for the requirement
    const requirementTagsResult = await db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
        createdByUserId: tags.createdByUserId,
      })
      .from(requirementTags)
      .innerJoin(tags, eq(requirementTags.tagId, tags.id))
      .where(eq(requirementTags.requirementId, requirementId))
      .orderBy(tags.name);

    return NextResponse.json(requirementTagsResult);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error fetching requirement tags:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await requireAuthContext();
    const { project, organizationId } = context;

    // Check permission to update requirements
    const canUpdate = checkPermissionWithContext('requirement', 'update', context);

    if (!canUpdate) {
      return NextResponse.json(
        { error: 'Insufficient permissions to update requirement tags' },
        { status: 403 }
      );
    }

    const { id: requirementId } = await params;
    const body = await request.json();
    const tagIds = body?.tagIds;

    if (!Array.isArray(tagIds)) {
      return NextResponse.json({ error: 'Tag IDs must be an array' }, { status: 400 });
    }

    const validTagIds = tagIds.filter(
      (tagId): tagId is string => typeof tagId === 'string' && tagId.trim().length > 0
    );

    if (validTagIds.length !== tagIds.length) {
      return NextResponse.json({ error: 'Tag IDs must be non-empty strings' }, { status: 400 });
    }

    const normalizedTagIds = Array.from(new Set(validTagIds));

    if (normalizedTagIds.length !== validTagIds.length) {
      return NextResponse.json({ error: 'Duplicate tag IDs are not allowed' }, { status: 400 });
    }

    // Validate maximum number of tags per requirement (10)
    if (normalizedTagIds.length > 10) {
      return NextResponse.json({ error: 'Maximum of 10 tags allowed per requirement' }, { status: 400 });
    }

    // Verify requirement exists AND belongs to current org/project to prevent IDOR
    const requirement = await db
      .select({ id: requirements.id })
      .from(requirements)
      .where(and(
        eq(requirements.id, requirementId),
        eq(requirements.organizationId, organizationId),
        eq(requirements.projectId, project.id)
      ))
      .limit(1);

    if (requirement.length === 0) {
      return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
    }

    // Verify all tags belong to the same org/project to prevent cross-tenant assignment
    if (normalizedTagIds.length > 0) {
      const validTags = await db
        .select({ id: tags.id })
        .from(tags)
        .where(
          and(
            inArray(tags.id, normalizedTagIds),
            eq(tags.organizationId, organizationId),
            eq(tags.projectId, project.id)
          )
        );

      if (validTags.length !== normalizedTagIds.length) {
        return NextResponse.json(
          { error: 'One or more tags are invalid or not accessible in this project' },
          { status: 400 }
        );
      }
    }

    // Remove existing tags for this requirement
    await db.delete(requirementTags).where(eq(requirementTags.requirementId, requirementId));

    // Add new tags
    if (normalizedTagIds.length > 0) {
      const requirementTagsToInsert = normalizedTagIds.map((tagId: string) => ({
        requirementId,
        tagId,
        assignedAt: new Date(),
      }));

      await db.insert(requirementTags).values(requirementTagsToInsert);
    }

    // Return updated tags
    const updatedTags = await db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
        createdByUserId: tags.createdByUserId,
      })
      .from(requirementTags)
      .innerJoin(tags, eq(requirementTags.tagId, tags.id))
      .where(eq(requirementTags.requirementId, requirementId))
      .orderBy(tags.name);

    return NextResponse.json(updatedTags);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error updating requirement tags:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
