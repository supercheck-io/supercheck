import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { tags, testTags, requirementTags } from '@/db/schema';
import { eq, count, and } from 'drizzle-orm';
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { project, organizationId } = await requireProjectContext();

    const resolvedParams = await params;
    const tagId = resolvedParams.id;

    if (!tagId) {
      return NextResponse.json({ error: 'Tag ID is required' }, { status: 400 });
    }

    // Check if the tag exists and get creator information
    const existingTag = await db
      .select()
      .from(tags)
      .where(eq(tags.id, tagId))
      .limit(1);

    if (existingTag.length === 0) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Check permission to delete tag, including creator check for PROJECT_EDITOR
    const canDelete = await hasPermission('tag', 'delete', { 
      organizationId, 
      projectId: project.id,
      resourceCreatorId: existingTag[0].createdByUserId ?? undefined 
    });
    
    if (!canDelete) {
      return NextResponse.json(
        { error: 'Insufficient permissions to delete this tag' },
        { status: 403 }
      );
    }

    // Check if the tag is being used in any tests
    const testUsageCount = await db
      .select({ count: count() })
      .from(testTags)
      .where(eq(testTags.tagId, tagId));

    // Check if the tag is being used in any requirements
    const requirementUsageCount = await db
      .select({ count: count() })
      .from(requirementTags)
      .where(eq(requirementTags.tagId, tagId));

    const testCount = testUsageCount[0]?.count ?? 0;
    const requirementCount = requirementUsageCount[0]?.count ?? 0;
    const totalUsageCount = testCount + requirementCount;

    if (totalUsageCount > 0) {
      // Build a descriptive error message
      const usageDetails: string[] = [];
      if (testCount > 0) {
        usageDetails.push(`${testCount} test${testCount === 1 ? '' : 's'}`);
      }
      if (requirementCount > 0) {
        usageDetails.push(`${requirementCount} requirement${requirementCount === 1 ? '' : 's'}`);
      }
      
      return NextResponse.json({ 
        error: `Cannot delete tag "${existingTag[0].name}" because it is currently used in ${usageDetails.join(' and ')}. Please remove the tag from all resources before deleting it.`,
        usageCount: totalUsageCount,
        testCount,
        requirementCount,
        tagName: existingTag[0].name
      }, { status: 409 });
    }

    // Delete the tag
    await db
      .delete(tags)
      .where(eq(tags.id, tagId));

    return NextResponse.json({ 
      message: 'Tag deleted successfully',
      deletedTag: existingTag[0]
    });
  } catch (error) {
    console.error('Error deleting tag:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { project, organizationId } = await requireProjectContext();

    // Check permission to view tags
    const canView = await hasPermission('tag', 'view', {
      organizationId,
      projectId: project.id
    });

    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const resolvedParams = await params;
    const tagId = resolvedParams.id;

    if (!tagId) {
      return NextResponse.json({ error: 'Tag ID is required' }, { status: 400 });
    }

    // Get the tag - SCOPED BY ORG/PROJECT to prevent IDOR
    const tag = await db
      .select()
      .from(tags)
      .where(and(
        eq(tags.id, tagId),
        eq(tags.organizationId, organizationId),
        eq(tags.projectId, project.id)
      ))
      .limit(1);

    if (tag.length === 0) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    return NextResponse.json(tag[0]);
  } catch (error) {
    console.error('Error fetching tag:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { project, organizationId } = await requireProjectContext();

    // Check permission to manage tags
    const canManage = await hasPermission('tag', 'manage', {
      organizationId,
      projectId: project.id
    });

    if (!canManage) {
      return NextResponse.json(
        { error: 'Insufficient permissions to update tags' },
        { status: 403 }
      );
    }

    const resolvedParams = await params;
    const tagId = resolvedParams.id;
    const { name, color } = await request.json();

    if (!tagId) {
      return NextResponse.json({ error: 'Tag ID is required' }, { status: 400 });
    }

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
    }

    // Check if the tag exists AND belongs to current org/project
    const existingTag = await db
      .select()
      .from(tags)
      .where(and(
        eq(tags.id, tagId),
        eq(tags.organizationId, organizationId),
        eq(tags.projectId, project.id)
      ))
      .limit(1);

    if (existingTag.length === 0) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Check if another tag with the same name exists in the same project
    const duplicateTag = await db
      .select()
      .from(tags)
      .where(and(
        eq(tags.name, name.trim()),
        eq(tags.organizationId, organizationId),
        eq(tags.projectId, project.id)
      ))
      .limit(1);

    if (duplicateTag.length > 0 && duplicateTag[0].id !== tagId) {
      return NextResponse.json({ error: 'Tag with this name already exists' }, { status: 409 });
    }

    // Update the tag
    const [updatedTag] = await db
      .update(tags)
      .set({
        name: name.trim(),
        color: color || existingTag[0].color,
        updatedAt: new Date(),
      })
      .where(eq(tags.id, tagId))
      .returning();

    return NextResponse.json(updatedTag);
  } catch (error) {
    console.error('Error updating tag:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 