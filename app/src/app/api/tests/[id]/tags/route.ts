import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { tests, testTags, tags } from '@/db/schema';
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

    // Check permission to view tests
    const canView = checkPermissionWithContext('test', 'view', context);

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
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error fetching test tags:', error);
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

    // Check permission to update tests
    const canUpdate = checkPermissionWithContext('test', 'update', context);

    if (!canUpdate) {
      return NextResponse.json(
        { error: 'Insufficient permissions to update test tags' },
        { status: 403 }
      );
    }

    const { id: testId } = await params;
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

    // Validate maximum number of tags per test (10)
    if (normalizedTagIds.length > 10) {
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

    // Remove existing tags for this test
    await db.delete(testTags).where(eq(testTags.testId, testId));

    // Add new tags
    if (normalizedTagIds.length > 0) {
      const testTagsToInsert = normalizedTagIds.map((tagId: string) => ({
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
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error updating test tags:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await requireAuthContext();
    const { project, organizationId } = context;

    // Check permission to update tests
    const canUpdate = checkPermissionWithContext('test', 'update', context);

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
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error removing test tag:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 