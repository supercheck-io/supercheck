import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { 
  requirements, 
  requirementCoverageSnapshots,
  requirementTags,
  testRequirements,
  tests,
  tags,
  type RequirementPriority,
  type RequirementCoverageStatus,
} from "@/db/schema";
import { desc, eq, and, sql, like, or, inArray } from "drizzle-orm";
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError } from '@/lib/auth-context';
import {
  createRequirementWithRelations,
  getRequirementDto,
  restCreateRequirementSchema,
  toServiceContext,
} from '@/lib/requirements/service';
import { loadCreators } from "@/lib/creators";

// The dashboard calls this endpoint without paging and paginates client-side, so the default stays 500.
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 500;
const MAX_PAGE = 100_000;

/** Parse a query integer, falling back to `fallback` for missing/NaN values and clamping to [min, max]. */
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export async function GET(request: NextRequest) {
  try {
    // Require authentication and project context
    const context = await requireAuthContext();

    // PERFORMANCE: Use checkPermissionWithContext to avoid 5-8 duplicate DB queries
    const canView = checkPermissionWithContext('requirement', 'view', context);

    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = clampInt(searchParams.get('page'), DEFAULT_PAGE, 1, MAX_PAGE);
    const pageSize = clampInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const search = searchParams.get('search') || undefined;
    const priority = searchParams.get('priority') as RequirementPriority | undefined;
    const status = searchParams.get('status') as RequirementCoverageStatus | undefined;

    const offset = (page - 1) * pageSize;

    // Build where conditions - SECURITY: Always filter by project
    const conditions = [eq(requirements.projectId, context.project.id)];

    if (search) {
      conditions.push(
        or(
          like(requirements.title, `%${search}%`),
          like(requirements.description, `%${search}%`)
        ) as ReturnType<typeof eq>
      );
    }

    if (priority) {
      conditions.push(eq(requirements.priority, priority));
    }

    if (status) {
      conditions.push(
        sql`(${requirementCoverageSnapshots.status} = ${status} OR (${requirementCoverageSnapshots.status} IS NULL AND ${status} = 'missing'))`
      );
    }

    const whereCondition = and(...conditions);

    // PERFORMANCE: Run count and data queries in parallel
    const [countResult, results] = await Promise.all([
      // Count query
      db
        .select({ count: sql<number>`count(*)` })
        .from(requirements)
        .leftJoin(
          requirementCoverageSnapshots,
          eq(requirements.id, requirementCoverageSnapshots.requirementId)
        )
        .where(whereCondition),
      // Data query with coverage join
      db
        .select({
          id: requirements.id,
          title: requirements.title,
          description: requirements.description,
          priority: requirements.priority,
          sourceDocumentId: requirements.sourceDocumentId,
          sourceSection: requirements.sourceSection,
          externalId: requirements.externalId,
          externalUrl: requirements.externalUrl,
          externalProvider: requirements.externalProvider,
          createdBy: requirements.createdBy,
          createdByUserId: requirements.createdByUserId,
          createdAt: requirements.createdAt,
          updatedAt: requirements.updatedAt,
          coverageStatus: requirementCoverageSnapshots.status,
          linkedTestCount: requirementCoverageSnapshots.linkedTestCount,
          passedTestCount: requirementCoverageSnapshots.passedTestCount,
          failedTestCount: requirementCoverageSnapshots.failedTestCount,
          sourceDocumentName: sql<string | null>`(
            SELECT name FROM requirement_documents 
            WHERE id = ${requirements.sourceDocumentId}
            AND project_id = ${requirements.projectId}
            AND organization_id = ${requirements.organizationId}
          )`.as("source_document_name"),
        })
        .from(requirements)
        .leftJoin(
          requirementCoverageSnapshots,
          eq(requirements.id, requirementCoverageSnapshots.requirementId)
        )
        .where(whereCondition)
        .orderBy(desc(requirements.createdAt))
        .offset(offset)
        .limit(pageSize),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    // Fetch tags for all requirements
    const requirementIds = results.map((r) => r.id);
    const requirementTagsData =
      requirementIds.length > 0
        ? await db
            .select({
              requirementId: requirementTags.requirementId,
              tagId: tags.id,
              tagName: tags.name,
              tagColor: tags.color,
            })
            .from(requirementTags)
            .innerJoin(
              tags,
              and(
                eq(requirementTags.tagId, tags.id),
                eq(tags.projectId, context.project.id)
              )
            )
            .where(inArray(requirementTags.requirementId, requirementIds))
        : [];

    // Linked test ids, batch-loaded (scoped to this project's tests) so API clients avoid a per-row detail fetch
    const linkedTestRows =
      requirementIds.length > 0
        ? await db
            .select({
              requirementId: testRequirements.requirementId,
              testId: testRequirements.testId,
            })
            .from(testRequirements)
            .innerJoin(
              tests,
              and(
                eq(testRequirements.testId, tests.id),
                eq(tests.projectId, context.project.id),
                eq(tests.organizationId, context.organizationId)
              )
            )
            .where(inArray(testRequirements.requirementId, requirementIds))
        : [];
    const testIdsMap = new Map<string, string[]>();
    linkedTestRows.forEach(({ requirementId, testId }) => {
      const ids = testIdsMap.get(requirementId) ?? [];
      ids.push(testId);
      testIdsMap.set(requirementId, ids);
    });

    // Build a map of requirementId -> tags
    const requirementTagsMap = new Map<
      string,
      Array<{ id: string; name: string; color: string | null }>
    >();
    requirementTagsData.forEach(({ requirementId, tagId, tagName, tagColor }) => {
      if (!requirementTagsMap.has(requirementId)) {
        requirementTagsMap.set(requirementId, []);
      }
      requirementTagsMap.get(requirementId)!.push({
        id: tagId,
        name: tagName,
        color: tagColor,
      });
    });

    // Transform results with tags and default coverage values
    const creatorOf = await loadCreators(results.map((r) => r.createdByUserId));
    const data = results.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      priority: r.priority,
      tags: requirementTagsMap.get(r.id) || [],
      // Additive for API clients: stored casing, sorted
      tagNames: (requirementTagsMap.get(r.id) || []).map((t) => t.name).sort(),
      testIds: testIdsMap.get(r.id) || [],
      sourceDocumentId: r.sourceDocumentId,
      sourceDocumentName: r.sourceDocumentName,
      sourceSection: r.sourceSection,
      externalId: r.externalId,
      externalUrl: r.externalUrl,
      externalProvider: r.externalProvider,
      createdBy: r.createdBy,
      ...creatorOf(r.createdByUserId),
      createdAt: r.createdAt?.toISOString() ?? null,
      updatedAt: r.updatedAt?.toISOString() ?? null,
      coverageStatus: (r.coverageStatus as RequirementCoverageStatus) ?? "missing",
      linkedTestCount: r.linkedTestCount ?? 0,
      passedTestCount: r.passedTestCount ?? 0,
      failedTestCount: r.failedTestCount ?? 0,
    }));

    return NextResponse.json({
      data,
      requirements: data, // Alias for backward compatibility
      total,
      page,
      pageSize,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error fetching requirements:', error);
    return NextResponse.json(
      { error: 'Failed to fetch requirements' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAuthContext();

    if (!checkPermissionWithContext('requirement', 'create', context)) {
      return NextResponse.json(
        { error: 'Insufficient permissions to create requirements' },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = restCreateRequirementSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const serviceCtx = toServiceContext(context);
    const result = await createRequirementWithRelations(serviceCtx, parsed.data);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? 'Failed to create requirement' },
        { status: result.code === 'conflict' ? 409 : 400 }
      );
    }

    const requirement = await getRequirementDto(serviceCtx, result.id);
    return NextResponse.json({ requirement }, { status: 201 });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    console.error('Error creating requirement:', error);
    return NextResponse.json(
      { error: 'Failed to create requirement' },
      { status: 500 }
    );
  }
}
