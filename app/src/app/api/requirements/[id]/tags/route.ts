import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { requirements, requirementTags, tags } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { project, organizationId } = await requireProjectContext();

    // Check permission to view requirements
    const canView = await hasPermission('requirement', 'view', {
      organizationId,
      projectId: project.id
    });

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
    console.error('Error fetching requirement tags:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { project, organizationId } = await requireProjectContext();

    // Check permission to update requirements
    const canUpdate = await hasPermission('requirement', 'update', {
      organizationId,
      projectId: project.id
    });

    if (!canUpdate) {
      return NextResponse.json(
        { error: 'Insufficient permissions to update requirement tags' },
        { status: 403 }
      );
    }

    const { id: requirementId } = await params;
    const { tagIds } = await request.json();

    if (!Array.isArray(tagIds)) {
      return NextResponse.json({ error: 'Tag IDs must be an array' }, { status: 400 });
    }

    // Validate maximum number of tags per requirement (10)
    if (tagIds.length > 10) {
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

    // Remove existing tags for this requirement
    await db.delete(requirementTags).where(eq(requirementTags.requirementId, requirementId));

    // Add new tags
    if (tagIds.length > 0) {
      const requirementTagsToInsert = tagIds.map((tagId: string) => ({
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
    console.error('Error updating requirement tags:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
