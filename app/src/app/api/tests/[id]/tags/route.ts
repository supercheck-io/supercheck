import { isUuid } from "@/lib/uuid";
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { tests, testTags, tags } from '@/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { MAX_TAGS_PER_ENTITY, TagLimitError, tagPatchSchema } from '@/lib/tag-patch';
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError } from '@/lib/auth-context';
import { logAuditEvent } from '@/lib/audit-logger';

// A tag deleted after validation fails the insert with FK violation 23503 (drizzle wraps the driver error in `cause`).
// Only the tag FK: a concurrently deleted test or monitor must not read as a missing tag.
const isFkViolation = (e: unknown) =>
  [e, (e as { cause?: unknown })?.cause].some((x) => {
    const pg = x as { code?: string; constraint_name?: string } | undefined;
    return pg?.code === "23503" && Boolean(pg.constraint_name?.endsWith("_tag_id_tags_id_fk"));
  });

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
    if (!isUuid((await params).id)) return NextResponse.json({ error: "Test not found" }, { status: 404 });
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
    if (!isUuid(testId)) return NextResponse.json({ error: "Test not found" }, { status: 404 });
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

    // Replace in one transaction under the same row lock as PATCH, so a concurrent PATCH cannot push past the cap.
    await db.transaction(async (tx) => {
      await tx
        .select({ id: tests.id })
        .from(tests)
        .where(and(eq(tests.id, testId), eq(tests.organizationId, organizationId), eq(tests.projectId, project.id)))
        .for('update');
      await tx.delete(testTags).where(eq(testTags.testId, testId));
      if (normalizedTagIds.length > 0) {
        await tx.insert(testTags).values(normalizedTagIds.map((tagId: string) => ({ testId, tagId })));
      }
      await logAuditEvent(
        {
          userId: context.userId,
          organizationId,
          action: 'test_tags_updated',
          resource: 'test',
          resourceId: testId,
          metadata: { tagIds: normalizedTagIds, projectId: project.id },
          success: true,
        },
        tx,
        { strict: true },
      );
    });

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
    if (isFkViolation(error)) return NextResponse.json({ error: "One or more tags no longer exist" }, { status: 400 });
    console.error('Error updating test tags:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await requireAuthContext();
    const { project, organizationId } = context;

    if (!checkPermissionWithContext('test', 'update', context)) {
      return NextResponse.json(
        { error: 'Insufficient permissions to update test tags' },
        { status: 403 }
      );
    }

    const { id: testId } = await params;
    if (!isUuid(testId)) return NextResponse.json({ error: "Test not found" }, { status: 404 });

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = tagPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body: add/remove must be arrays of tag UUIDs' }, { status: 400 });
    }
    const { add, remove } = parsed.data;

    const testScope = and(
      eq(tests.id, testId),
      eq(tests.organizationId, organizationId),
      eq(tests.projectId, project.id)
    );
    const test = await db.select({ id: tests.id }).from(tests).where(testScope).limit(1);
    if (test.length === 0) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 });
    }

    if (add.length > 0) {
      const validTags = await db
        .select({ id: tags.id })
        .from(tags)
        .where(and(inArray(tags.id, add), eq(tags.organizationId, organizationId), eq(tags.projectId, project.id)));
      if (validTags.length !== add.length) {
        return NextResponse.json(
          { error: 'One or more tags are invalid or not accessible in this project' },
          { status: 400 }
        );
      }
    }

    try {
      await db.transaction(async (tx) => {
        // Row lock serializes concurrent patches of one test so the cap check below cannot be raced.
        const locked = await tx.select({ id: tests.id }).from(tests).where(testScope).for('update');
        if (locked.length === 0) throw new TagLimitError('not-found');
        if (remove.length > 0) {
          await tx.delete(testTags).where(and(eq(testTags.testId, testId), inArray(testTags.tagId, remove)));
        }
        if (add.length > 0) {
          await tx.insert(testTags).values(add.map((tagId) => ({ testId, tagId }))).onConflictDoNothing();
          const [{ count }] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(testTags)
            .where(eq(testTags.testId, testId));
          if (count > MAX_TAGS_PER_ENTITY) throw new TagLimitError('limit');
        }
        await logAuditEvent(
          {
            userId: context.userId,
            organizationId,
            action: 'test_tags_updated',
            resource: 'test',
            resourceId: testId,
            metadata: { add, remove, projectId: project.id },
            success: true,
          },
          tx,
          { strict: true },
        );
      });
    } catch (error) {
      if (error instanceof TagLimitError) {
        return error.message === 'not-found'
          ? NextResponse.json({ error: 'Test not found' }, { status: 404 })
          : NextResponse.json({ error: `Maximum of ${MAX_TAGS_PER_ENTITY} tags allowed per test` }, { status: 400 });
      }
      throw error;
    }

    const updatedTags = await db
      .select({ id: tags.id, name: tags.name, color: tags.color, createdByUserId: tags.createdByUserId })
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
    if (isFkViolation(error)) return NextResponse.json({ error: "One or more tags no longer exist" }, { status: 400 });
    console.error('Error patching test tags:', error);
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
    if (!isUuid(testId)) return NextResponse.json({ error: "Test not found" }, { status: 404 });
    let tagId: unknown;
    try {
      ({ tagId } = await request.json());
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (typeof tagId !== 'string' || !isUuid(tagId)) {
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

    // Remove specific tag from test; the audit record commits with the change or not at all.
    await db.transaction(async (tx) => {
      const removed = await tx
        .delete(testTags)
        .where(and(eq(testTags.testId, testId), eq(testTags.tagId, tagId)))
        .returning({ tagId: testTags.tagId });
      if (removed.length === 0) return;
      await logAuditEvent(
        {
          userId: context.userId,
          organizationId,
          action: 'test_tag_removed',
          resource: 'test',
          resourceId: testId,
          metadata: { tagId, projectId: project.id },
          success: true,
        },
        tx,
        { strict: true },
      );
    });

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
