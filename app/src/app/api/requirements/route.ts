import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { 
  requirements, 
  requirementCoverageSnapshots,
  requirementTags,
  tags,
  type RequirementPriority,
  type RequirementCoverageStatus,
} from "@/db/schema";
import { desc, eq, and, sql, like, or, inArray } from "drizzle-orm";
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError } from '@/lib/auth-context';

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
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '500', 10);
    const search = searchParams.get('search') || undefined;
    const priority = searchParams.get('priority') as RequirementPriority | undefined;
    const status = searchParams.get('status') as RequirementCoverageStatus | undefined;

    // Validate pagination parameters
    if (page < 1 || pageSize < 1) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters. Page and pageSize must be >= 1' },
        { status: 400 }
      );
    }

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

    const whereCondition = and(...conditions);

    // PERFORMANCE: Run count and data queries in parallel
    const [countResult, results] = await Promise.all([
      // Count query
      db
        .select({ count: sql<number>`count(*)` })
        .from(requirements)
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
          createdAt: requirements.createdAt,
          updatedAt: requirements.updatedAt,
          coverageStatus: requirementCoverageSnapshots.status,
          linkedTestCount: requirementCoverageSnapshots.linkedTestCount,
          passedTestCount: requirementCoverageSnapshots.passedTestCount,
          failedTestCount: requirementCoverageSnapshots.failedTestCount,
          sourceDocumentName: sql<string | null>`(
            SELECT name FROM requirement_documents 
            WHERE id = ${requirements.sourceDocumentId}
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

    // Filter by status if specified (done in JS since it's a post-join filter)
    let filteredResults = results;
    if (status) {
      filteredResults = results.filter(
        (r) => (r.coverageStatus ?? "missing") === status
      );
    }

    // Fetch tags for all requirements
    const requirementIds = filteredResults.map((r) => r.id);
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
            .innerJoin(tags, eq(requirementTags.tagId, tags.id))
            .where(inArray(requirementTags.requirementId, requirementIds))
        : [];

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
    const data = filteredResults.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      priority: r.priority,
      tags: requirementTagsMap.get(r.id) || [],
      sourceDocumentId: r.sourceDocumentId,
      sourceDocumentName: r.sourceDocumentName,
      sourceSection: r.sourceSection,
      externalId: r.externalId,
      externalUrl: r.externalUrl,
      externalProvider: r.externalProvider,
      createdBy: r.createdBy,
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
