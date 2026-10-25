"use server";

import { eq, and, desc, sql, like, or, inArray } from "drizzle-orm";
import {
  requirements,
  requirementsInsertSchema,
  requirementCoverageSnapshots,
  requirementDocuments,
  testRequirements,
  tests,
  tags,
  requirementTags,
  type RequirementPriority,
  type RequirementCreatedBy,
  type RequirementCoverageStatus,
} from "@/db/schema";
import { db } from "@/utils/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "crypto";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  isInCallerScope,
  createRequirementRecord,
  updateRequirementRecord,
  deleteRequirementRecord,
  linkTestsRecord,
  syncRequirementTestsRecord,
  unlinkTestsRecord,
  exportRequirementsCsvRecord,
  type CreateRequirementInput,
  type UpdateRequirementInput,
} from "@/lib/requirements/service";
import {
  AT_RISK_PRIORITIES,
  accumulateRequirementCoverage,
} from "@/lib/dashboard/requirements-stats";

// ============================================================================
// TYPES
// ============================================================================

// Tag type for requirements (matching tests pattern)
export type RequirementTag = {
  id: string;
  name: string;
  color: string | null;
};

export type RequirementWithCoverage = {
  id: string;
  title: string;
  description: string | null;
  priority: RequirementPriority | null;
  tags: RequirementTag[];
  externalId: string | null;
  externalUrl: string | null;
  externalProvider: string | null;
  createdBy: RequirementCreatedBy;
  createdAt: Date | null;
  updatedAt: Date | null;
  // Source document reference
  sourceDocumentId: string | null;
  sourceDocumentName: string | null;
  sourceSection: string | null;
  // Coverage from snapshot
  coverageStatus: RequirementCoverageStatus;
  linkedTestCount: number;
  passedTestCount: number;
  failedTestCount: number;
};

export type RequirementListResponse = {
  requirements: RequirementWithCoverage[];
  total: number;
  page: number;
  pageSize: number;
};

// ============================================================================
// SCHEMAS
// ============================================================================

// Input schemas and types live in the shared service (also used by the REST routes).
export type { CreateRequirementInput, UpdateRequirementInput };

// ============================================================================
// TAG SYNC HELPERS
// ============================================================================

// ============================================================================
// LIST REQUIREMENTS
// ============================================================================

/**
 * Get paginated list of requirements with coverage status
 */
export async function getRequirements(options?: {
  page?: number;
  pageSize?: number;
  search?: string;
  priority?: RequirementPriority;
  status?: RequirementCoverageStatus;
}): Promise<RequirementListResponse> {
  const { userId, project, organizationId } = await requireProjectContext();

  // Check view permission (optimized - reuses context)
  const canView = checkPermissionWithContext("requirement", "view", {
    userId,
    organizationId,
    project,
  });

  if (!canView) {
    throw new Error("Insufficient permissions to view requirements");
  }

  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 500; // Default to 500 to fetch all requirements
  const offset = (page - 1) * pageSize;

  // Build where conditions
  const conditions = [eq(requirements.projectId, project.id)];

  if (options?.search) {
    conditions.push(
      or(
        like(requirements.title, `%${options.search}%`),
        like(requirements.description, `%${options.search}%`)
      ) as ReturnType<typeof eq>
    );
  }

  if (options?.priority) {
    conditions.push(eq(requirements.priority, options.priority));
  }

  if (options?.status) {
    conditions.push(
      sql`(${requirementCoverageSnapshots.status} = ${options.status} OR (${requirementCoverageSnapshots.status} IS NULL AND ${options.status} = 'missing'))`
    );
  }

  // Query with coverage join and document join
  const query = db
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
          AND project_id = ${requirements.projectId}
          AND organization_id = ${requirements.organizationId}
      )`.as("source_document_name"),
    })
    .from(requirements)
    .leftJoin(
      requirementCoverageSnapshots,
      eq(requirements.id, requirementCoverageSnapshots.requirementId)
    )
    .where(and(...conditions))
    .orderBy(desc(requirements.createdAt))
    .offset(offset)
    .limit(pageSize);

  const results = await query;

  // Get total count for pagination
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(requirements)
    .leftJoin(
    requirementCoverageSnapshots,
    eq(requirements.id, requirementCoverageSnapshots.requirementId)
  )
  .where(and(...conditions));

  const total = Number(countResult[0]?.count ?? 0);

  // Fetch tags for all requirements using the join table
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
              eq(tags.projectId, project.id)
            )
          )
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

  // Transform results with default coverage values
  const requirementsWithCoverage: RequirementWithCoverage[] =
    results.map((r) => ({
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
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      coverageStatus: (r.coverageStatus as RequirementCoverageStatus) ?? "missing",
      linkedTestCount: r.linkedTestCount ?? 0,
      passedTestCount: r.passedTestCount ?? 0,
      failedTestCount: r.failedTestCount ?? 0,
    }));

  return {
    requirements: requirementsWithCoverage,
    total,
    page,
    pageSize,
  };
}

/** Validation failures read as the first issue's message instead of a raw JSON dump. */
function readableError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message || "Invalid data provided";
  return error instanceof Error ? error.message : "Unknown error occurred";
}

// ============================================================================
// CREATE REQUIREMENT
// ============================================================================

/**
 * Create a new requirement
 */
export async function createRequirement(
  data: CreateRequirementInput
): Promise<{ id: string; success: boolean; error?: string }> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    // Check create permission (optimized - reuses context)
    const canCreate = checkPermissionWithContext("requirement", "create", {
      userId,
      organizationId,
      project,
    });

    if (!canCreate) {
      console.warn(
        `User ${userId} attempted to create requirement without permission`
      );
      return {
        id: "",
        success: false,
        error: "Insufficient permissions to create requirements",
      };
    }

    const result = await createRequirementRecord(
      {
        userId,
        organizationId,
        projectId: project.id,
        projectName: project.name,
      },
      data
    );
    if (!result.success) {
      return { id: "", success: false, error: result.error };
    }

    // Note: revalidatePath removed intentionally. The requirements page uses
    // TanStack Query for data fetching; client-side cache invalidation
    // (invalidatePostSaveQueries) handles freshness. Calling revalidatePath
    // here triggers an internal router.refresh() that can cancel subsequent
    // client-side navigation (router.push/replace).

    return { id: result.id, success: true };
  } catch (error) {
    console.error("Error creating requirement:", error);
    return {
      id: "",
      success: false,
      error: readableError(error),
    };
  }
}

// ============================================================================
// UPDATE REQUIREMENT
// ============================================================================

/**
 * Update an existing requirement
 */
export async function updateRequirement(
  data: UpdateRequirementInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    // Check update permission (optimized - reuses context)
    const canUpdate = checkPermissionWithContext("requirement", "update", {
      userId,
      organizationId,
      project,
    });

    if (!canUpdate) {
      console.warn(
        `User ${userId} attempted to update requirement ${data.id} without permission`
      );
      return {
        success: false,
        error: "Insufficient permissions to update requirements",
      };
    }

    const result = await updateRequirementRecord(
      {
        userId,
        organizationId,
        projectId: project.id,
        projectName: project.name,
      },
      data
    );
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Note: revalidatePath removed intentionally — see createRequirement comment.

    return { success: true };
  } catch (error) {
    console.error("Error updating requirement:", error);
    return {
      success: false,
      error: readableError(error),
    };
  }
}

// ============================================================================
// DELETE REQUIREMENT
// ============================================================================

/**
 * Delete a requirement (cascade deletes snapshots and test links)
 */
export async function deleteRequirement(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    // Check delete permission (optimized - reuses context)
    const canDelete = checkPermissionWithContext("requirement", "delete", {
      userId,
      organizationId,
      project,
    });

    if (!canDelete) {
      console.warn(
        `User ${userId} attempted to delete requirement ${id} without permission`
      );
      return {
        success: false,
        error: "Insufficient permissions to delete requirements",
      };
    }

    const result = await deleteRequirementRecord(
      {
        userId,
        organizationId,
        projectId: project.id,
        projectName: project.name,
      },
      id
    );
    if (!result.success) {
      return { success: false, error: result.error };
    }

    revalidatePath("/requirements");

    return { success: true };
  } catch (error) {
    console.error("Error deleting requirement:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// ============================================================================
// BULK DELETE REQUIREMENTS
// ============================================================================

/**
 * Delete multiple requirements at once
 */
export async function deleteRequirements(
  ids: string[]
): Promise<{ success: boolean; error?: string; deletedCount: number }> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    // Check delete permission (optimized - reuses context)
    const canDelete = checkPermissionWithContext("requirement", "delete", {
      userId,
      organizationId,
      project,
    });

    if (!canDelete) {
      console.warn(
        `User ${userId} attempted to delete requirements without permission`
      );
      return {
        success: false,
        error: "Insufficient permissions to delete requirements",
        deletedCount: 0,
      };
    }

    if (ids.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    // Delete requirements (cascade handles snapshots and test links)
    await db
      .delete(requirements)
      .where(
        and(
          inArray(requirements.id, ids),
          eq(requirements.projectId, project.id),
          eq(requirements.organizationId, organizationId)
        )
      );

    // Log audit event
    await logAuditEvent({
      userId,
      action: "requirements_bulk_deleted",
      resource: "requirement",
      resourceId: ids.join(","),
      metadata: {
        organizationId,
        count: ids.length,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

    revalidatePath("/requirements");

    return { success: true, deletedCount: ids.length };
  } catch (error) {
    console.error("Error bulk deleting requirements:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      deletedCount: 0,
    };
  }
}

// ============================================================================
// LINK TESTS TO REQUIREMENT
// ============================================================================

export async function linkTestsToRequirement(
  requirementId: string,
  testIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {

    const { userId, project, organizationId } = await requireProjectContext();

    // Check update permission (optimized - reuses context)
    const canUpdate = checkPermissionWithContext("requirement", "update", {
      userId,
      organizationId,
      project,
    });

    if (!canUpdate) {
      return {
        success: false,
        error: "Insufficient permissions to link tests",
      };
    }

    const result = await linkTestsRecord(
      {
        userId,
        organizationId,
        projectId: project.id,
        projectName: project.name,
      },
      requirementId,
      testIds
    );
    if (!result.success) {
      return { success: false, error: result.error };
    }

    revalidatePath("/requirements");

    return { success: true };
  } catch (error) {
    console.error("Error linking tests to requirement:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Sync all tests linked to a requirement in a single operation.
 * Replaces existing links with the provided set and updates coverage once.
 */
export async function syncRequirementTests(
  requirementId: string,
  testIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    const canUpdate = checkPermissionWithContext("requirement", "update", {
      userId,
      organizationId,
      project,
    });

    if (!canUpdate) {
      return {
        success: false,
        error: "Insufficient permissions to update requirement tests",
      };
    }

    const result = await syncRequirementTestsRecord(
      {
        userId,
        organizationId,
        projectId: project.id,
        projectName: project.name,
      },
      requirementId,
      testIds
    );
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Note: revalidatePath removed intentionally — see createRequirement comment.

    return { success: true };
  } catch (error) {
    console.error("Error syncing tests to requirement:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Unlink a test from a requirement
 */
export async function unlinkTestFromRequirement(
  requirementId: string,
  testId: string
): Promise<{ success: boolean; error?: string }> {
  try {

    const { userId, project, organizationId } = await requireProjectContext();

    // Check update permission (optimized - reuses context)
    const canUpdate = checkPermissionWithContext("requirement", "update", {
      userId,
      organizationId,
      project,
    });

    if (!canUpdate) {
      return {
        success: false,
        error: "Insufficient permissions to unlink tests",
      };
    }

    const result = await unlinkTestsRecord(
      {
        userId,
        organizationId,
        projectId: project.id,
        projectName: project.name,
      },
      requirementId,
      [testId]
    );
    if (!result.success) {
      return { success: false, error: result.error };
    }

    revalidatePath("/requirements");

    return { success: true };
  } catch (error) {
    console.error("Error unlinking test from requirement:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// ============================================================================
// COVERAGE SNAPSHOT UPDATE
// ============================================================================

// ============================================================================
// GET DASHBOARD STATS
// ============================================================================

/**
 * Get requirements coverage stats for the dashboard
 */
export async function getRequirementsDashboardStats(): Promise<{
  total: number;
  covered: number;
  failing: number;
  missing: number;
  coveragePercent: number;
  atRiskCount: number;
}> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    // Check view permission (optimized - reuses context)
    const canView = checkPermissionWithContext("requirement", "view", {
      userId,
      organizationId,
      project,
    });

    if (!canView) {
      return {
        total: 0,
        covered: 0,
        failing: 0,
        missing: 0,
        coveragePercent: 0,
        atRiskCount: 0,
      };
    }

    // Get coverage stats by status
    const stats = await db
      .select({
        status: requirementCoverageSnapshots.status,
        count: sql<number>`count(*)`,
      })
      .from(requirements)
      .leftJoin(
        requirementCoverageSnapshots,
        eq(requirements.id, requirementCoverageSnapshots.requirementId)
      )
      .where(eq(requirements.projectId, project.id))
      .groupBy(requirementCoverageSnapshots.status);

    const { total, covered, failing, missing } =
      accumulateRequirementCoverage(stats);

    // At-risk = AT_RISK_PRIORITIES requirements with failing/missing/no coverage
    const atRiskResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(requirements)
      .leftJoin(
        requirementCoverageSnapshots,
        eq(requirements.id, requirementCoverageSnapshots.requirementId)
      )
      .where(
        and(
          eq(requirements.projectId, project.id),
          inArray(requirements.priority, [...AT_RISK_PRIORITIES]),
          or(
            eq(requirementCoverageSnapshots.status, "failing"),
            eq(requirementCoverageSnapshots.status, "missing"),
            sql`${requirementCoverageSnapshots.status} IS NULL`
          )
        )
      );

    const atRiskCount = Number(atRiskResult[0]?.count ?? 0);
    const coveragePercent = total > 0 ? Math.round((covered / total) * 100) : 0;

    return {
      total,
      covered,
      failing,
      missing,
      coveragePercent,
      atRiskCount,
    };
  } catch (error) {
    console.error("Error getting requirements dashboard stats:", error);
    return {
      total: 0,
      covered: 0,
      failing: 0,
      missing: 0,
      coveragePercent: 0,
      atRiskCount: 0,
    };
  }
}

// ============================================================================
// GET SINGLE REQUIREMENT
// ============================================================================

/**
 * Get a single requirement with coverage info
 */
export async function getRequirement(
  id: string
): Promise<RequirementWithCoverage | null> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    // Check view permission (optimized - reuses context)
    const canView = checkPermissionWithContext("requirement", "view", {
      userId,
      organizationId,
      project,
    });

    if (!canView) {
      return null;
    }

    const result = await db
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
          AND project_id = ${requirements.projectId}
          AND organization_id = ${requirements.organizationId}
        )`.as("source_document_name"),
      })
      .from(requirements)
      .leftJoin(
        requirementCoverageSnapshots,
        eq(requirements.id, requirementCoverageSnapshots.requirementId)
      )
      .where(
        and(eq(requirements.id, id), eq(requirements.projectId, project.id))
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    // Fetch tags for this requirement
    const requirementTagsData = await db
      .select({
        tagId: tags.id,
        tagName: tags.name,
        tagColor: tags.color,
      })
      .from(requirementTags)
      .innerJoin(
            tags,
            and(
              eq(requirementTags.tagId, tags.id),
              eq(tags.projectId, project.id)
            )
          )
      .where(eq(requirementTags.requirementId, id));

    const r = result[0];
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      priority: r.priority,
      tags: requirementTagsData.map((t) => ({
        id: t.tagId,
        name: t.tagName,
        color: t.tagColor,
      })),
      sourceDocumentId: r.sourceDocumentId,
      sourceDocumentName: r.sourceDocumentName,
      sourceSection: r.sourceSection,
      externalId: r.externalId,
      externalUrl: r.externalUrl,
      externalProvider: r.externalProvider,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      coverageStatus: (r.coverageStatus as RequirementCoverageStatus) ?? "missing",
      linkedTestCount: r.linkedTestCount ?? 0,
      passedTestCount: r.passedTestCount ?? 0,
      failedTestCount: r.failedTestCount ?? 0,
    };
  } catch (error) {
    console.error("Error getting requirement:", error);
    return null;
  }
}

// ============================================================================
// GET LINKED TESTS
// ============================================================================

/**
 * Get all tests linked to a requirement
 */
// Export type for frontend reuse
export type LinkedTest = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  tags: { id: string; name: string; color: string | null }[];
};

/**
 * Get all tests linked to a requirement
 */
export async function getLinkedTests(
  requirementId: string
): Promise<LinkedTest[]> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    // Check view permission (optimized - reuses context)
    const canView = checkPermissionWithContext("requirement", "view", {
      userId,
      organizationId,
      project,
    });

    if (!canView) {
      return [];
    }

    if (
      !(await isInCallerScope(requirementId, [], {
        projectId: project.id,
        organizationId,
      }))
    ) {
      return [];
    }

    // Import tests table dynamically to avoid circular deps
    const { tests, tags, testTags } = await import("@/db/schema");

    const linkedTestsData = await db
      .select({
        id: tests.id,
        title: tests.title,
        type: tests.type,
        description: tests.description,
      })
      .from(testRequirements)
      .innerJoin(
        tests,
        and(
          eq(testRequirements.testId, tests.id),
          eq(tests.projectId, project.id),
          eq(tests.organizationId, organizationId)
        )
      )
      .where(eq(testRequirements.requirementId, requirementId));

    if (linkedTestsData.length === 0) {
      return [];
    }

    // Fetch tags for these tests
    const testIds = linkedTestsData.map((t) => t.id);
    const tagsData = await db
      .select({
        testId: testTags.testId,
        tagId: tags.id,
        name: tags.name,
        color: tags.color,
      })
      .from(testTags)
      .innerJoin(tags, eq(testTags.tagId, tags.id))
      .where(inArray(testTags.testId, testIds));

    // Group tags by test ID
    const tagsByTestId = tagsData.reduce<Record<string, { id: string; name: string; color: string | null }[]>>((acc, curr) => {
      if (!acc[curr.testId]) {
        acc[curr.testId] = [];
      }
      acc[curr.testId].push({
        id: curr.tagId,
        name: curr.name,
        color: curr.color,
      });
      return acc;
    }, {});

    return linkedTestsData.map((t) => ({
      id: t.id,
      title: t.title ?? "Untitled", // Keep title for backward compat if needed locally
      name: t.title ?? "Untitled",
      type: t.type ?? "unknown",
      description: t.description,
      tags: tagsByTestId[t.id] || [],
    }));
  } catch (error) {
    console.error("Error getting linked tests:", error);
    return [];
  }
}

// ============================================================================
// GET AVAILABLE TESTS FOR LINKING
// ============================================================================

/**
 * Get tests available for linking (not already linked to this requirement)
 */
export async function getAvailableTestsForLinking(
  requirementId: string,
  search?: string
): Promise<{ id: string; title: string; type: string }[]> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    // Check view permission (optimized - reuses context)
    const canView = checkPermissionWithContext("requirement", "view", {
      userId,
      organizationId,
      project,
    });

    if (!canView) {
      return [];
    }

    if (
      !(await isInCallerScope(requirementId, [], {
        projectId: project.id,
        organizationId,
      }))
    ) {
      return [];
    }

    // Import tests table
    const { tests } = await import("@/db/schema");

    // Get already linked test IDs
    const linkedTestIds = await db
      .select({ testId: testRequirements.testId })
      .from(testRequirements)
      .where(eq(testRequirements.requirementId, requirementId));

    const excludeIds = linkedTestIds.map((t) => t.testId);

    // Build query conditions
    const conditions = [eq(tests.projectId, project.id)];

    if (search && search.trim()) {
      conditions.push(like(tests.title, `%${search.trim()}%`));
    }

    // Get available tests
    let query = db
      .select({
        id: tests.id,
        title: tests.title,
        type: tests.type,
      })
      .from(tests)
      .where(and(...conditions))
      .limit(50);

    const availableTests = await query;

    // Filter out already linked tests
    return availableTests
      .filter((t) => !excludeIds.includes(t.id))
      .map((t) => ({
        id: t.id,
        title: t.title ?? "Untitled",
        type: t.type ?? "unknown",
      }));
  } catch (error) {
    console.error("Error getting available tests:", error);
    return [];
  }
}

// ============================================================================
// EXPORT REQUIREMENTS TO CSV
// ============================================================================

/**
 * Export all requirements to CSV format
 */
export async function exportRequirementsCsv(): Promise<{
  success: boolean;
  csv?: string;
  filename?: string;
  error?: string;
}> {
  try {
    const { project, organizationId, userId } = await requireProjectContext();

    // Check view permission (optimized - reuses context)
    const canView = checkPermissionWithContext("requirement", "view", {
      userId,
      organizationId,
      project,
    });

    if (!canView) {
      return { success: false, error: "Insufficient permissions" };
    }

    const { csv, filename } = await exportRequirementsCsvRecord({
        userId,
        organizationId,
        projectId: project.id,
        projectName: project.name,
      });

    return { success: true, csv, filename };
  } catch (error) {
    console.error("Error exporting requirements:", error);
    return { success: false, error: "Failed to export requirements" };
  }
}
