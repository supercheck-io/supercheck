import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { tests, testTags, tags } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { project, organizationId } = await requireProjectContext();

    // Check permission to view tests
    const canView = await hasPermission('test', 'view', {
      organizationId,
      projectId: project.id
    });

    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const { id: testId } = await params;

    // Verify test exists and belongs to current org/project
    const test = await db
      .select({ id: tests.id })
      .from(tests)
      .where(and(
        eq(tests.id, testId),
        eq(tests.organizationId, organizationId),
        eq(tests.projectId, project.id)
      ))
      .limit(1);

    if (test.length === 0) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 });
    }

    // Get tags for the test
    const testTagsResult = await db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
        createdByUserId: tags.createdByUserId,
      })
      .from(testTags)
      .innerJoin(tags, eq(testTags.tagId, tags.id))
      .where(eq(testTags.testId, testId))
      .orderBy(tags.name);

    return NextResponse.json(testTagsResult);
  } catch (error) {
    console.error('Error fetching test tags:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { project, organizationId } = await requireProjectContext();

    // Check permission to update tests
    const canUpdate = await hasPermission('test', 'update', {
      organizationId,
      projectId: project.id
    });

    if (!canUpdate) {
      return NextResponse.json(
        { error: 'Insufficient permissions to update test tags' },
        { status: 403 }
      );
    }

    const { id: testId } = await params;
    const { tagIds } = await request.json();

    if (!Array.isArray(tagIds)) {
      return NextResponse.json({ error: 'Tag IDs must be an array' }, { status: 400 });
    }

    // Validate maximum number of tags per test (10)
    if (tagIds.length > 10) {
      return NextResponse.json({ error: 'Maximum of 10 tags allowed per test' }, { status: 400 });
    }

    // Verify test exists AND belongs to current org/project to prevent IDOR
    const test = await db
      .select({ id: tests.id })
      .from(tests)
      .where(and(
        eq(tests.id, testId),
        eq(tests.organizationId, organizationId),
        eq(tests.projectId, project.id)
      ))
      .limit(1);

    if (test.length === 0) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 });
    }

    // Remove existing tags for this test
    await db.delete(testTags).where(eq(testTags.testId, testId));

    // Add new tags
    if (tagIds.length > 0) {
      const testTagsToInsert = tagIds.map((tagId: string) => ({
        testId,
        tagId,
      }));

      await db.insert(testTags).values(testTagsToInsert);
    }

    // Return updated tags
    const updatedTags = await db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
        createdByUserId: tags.createdByUserId,
      })
      .from(testTags)
      .innerJoin(tags, eq(testTags.tagId, tags.id))
      .where(eq(testTags.testId, testId))
      .orderBy(tags.name);

    return NextResponse.json(updatedTags);
  } catch (error) {
    console.error('Error updating test tags:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { project, organizationId } = await requireProjectContext();

    // Check permission to update tests
    const canUpdate = await hasPermission('test', 'update', {
      organizationId,
      projectId: project.id
    });

    if (!canUpdate) {
      return NextResponse.json(
        { error: 'Insufficient permissions to update test tags' },
        { status: 403 }
      );
    }

    const { id: testId } = await params;
    const { tagId } = await request.json();

    if (!tagId) {
      return NextResponse.json({ error: 'Tag ID is required' }, { status: 400 });
    }

    // Verify test exists AND belongs to current org/project to prevent IDOR
    const test = await db
      .select({ id: tests.id })
      .from(tests)
      .where(and(
        eq(tests.id, testId),
        eq(tests.organizationId, organizationId),
        eq(tests.projectId, project.id)
      ))
      .limit(1);

    if (test.length === 0) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 });
    }

    // Remove specific tag from test
    await db
      .delete(testTags)
      .where(
        and(
          eq(testTags.testId, testId),
          eq(testTags.tagId, tagId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing test tag:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 