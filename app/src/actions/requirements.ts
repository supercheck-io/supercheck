"use server";

import { eq, and, desc, sql, like, or, inArray } from "drizzle-orm";
import {
  requirements,
  requirementsInsertSchema,
  requirementCoverageSnapshots,
  testRequirements,
  type RequirementPriority,
  type RequirementCreatedBy,
  type RequirementCoverageStatus,
} from "@/db/schema";
import { db } from "@/utils/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "crypto";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";

// ============================================================================
// TYPES
// ============================================================================

export type RequirementWithCoverage = {
  id: string;
  title: string;
  description: string | null;
  priority: RequirementPriority | null;
  tags: string | null;
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

// Create requirement schema (omit auto-generated fields)
const createRequirementSchema = requirementsInsertSchema.omit({
  id: true,
  organizationId: true,
  projectId: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
});

// Update requirement schema (optional fields except title)
const updateRequirementSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().optional().nullable(),
  priority: z.enum(["low", "medium", "high"]).optional().nullable(),
  tags: z.string().optional().nullable(),
  externalId: z.string().optional().nullable().or(z.literal("")),
  externalUrl: z.string().url().optional().nullable().or(z.literal("")),
  externalProvider: z.string().optional().nullable().or(z.literal("")),
});

export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;
export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;

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
  const { project, organizationId } = await requireProjectContext();

  // Check view permission
  const canView = await hasPermission("requirement", "view", {
    organizationId,
    projectId: project.id,
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

  // Query with coverage join and document join
  const query = db
    .select({
      id: requirements.id,
      title: requirements.title,
      description: requirements.description,
      priority: requirements.priority,
      tags: requirements.tags,
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
    .where(and(...conditions))
    .orderBy(desc(requirements.createdAt))
    .offset(offset)
    .limit(pageSize);

  // Apply status filter after join if needed
  const results = await query;

  // Filter by status if specified (done in JS since it's a post-join filter)
  let filteredResults = results;
  if (options?.status) {
    filteredResults = results.filter(
      (r) => (r.coverageStatus ?? "missing") === options.status
    );
  }

  // Get total count for pagination
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(requirements)
    .where(and(...conditions));

  const total = Number(countResult[0]?.count ?? 0);

  // Transform results with default coverage values
  const requirementsWithCoverage: RequirementWithCoverage[] =
    filteredResults.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      priority: r.priority,
      tags: r.tags,
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

    // Check create permission
    const canCreate = await hasPermission("requirement", "create", {
      organizationId,
      projectId: project.id,
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

    const validatedData = createRequirementSchema.parse(data);
    const newId = crypto.randomUUID();

    // Insert requirement
    await db.insert(requirements).values({
      id: newId,
      organizationId,
      projectId: project.id,
      title: validatedData.title,
      description: validatedData.description,
      priority: validatedData.priority as RequirementPriority,
      tags: validatedData.tags,
      sourceDocumentId: validatedData.sourceDocumentId,
      sourceSection: validatedData.sourceSection,
      externalId: validatedData.externalId,
      externalUrl: validatedData.externalUrl,
      externalProvider: validatedData.externalProvider,
      createdBy: (validatedData.createdBy as RequirementCreatedBy) ?? "user",
      createdByUserId: userId,
      createdAt: new Date(),
    });

    // Create initial coverage snapshot (status: missing)
    await db.insert(requirementCoverageSnapshots).values({
      requirementId: newId,
      status: "missing",
      linkedTestCount: 0,
      passedTestCount: 0,
      failedTestCount: 0,
      lastEvaluatedAt: new Date(),
    });

    // Log audit event
    await logAuditEvent({
      userId,
      action: "requirement_created",
      resource: "requirement",
      resourceId: newId,
      metadata: {
        organizationId,
        title: validatedData.title,
        priority: validatedData.priority,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

    revalidatePath("/requirements");

    return { id: newId, success: true };
  } catch (error) {
    console.error("Error creating requirement:", error);
    return {
      id: "",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
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

    // Check update permission
    const canUpdate = await hasPermission("requirement", "update", {
      organizationId,
      projectId: project.id,
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

    const validatedData = updateRequirementSchema.parse(data);

    // Update requirement
    await db
      .update(requirements)
      .set({
        title: validatedData.title,
        description: validatedData.description,
        priority: validatedData.priority as RequirementPriority | null,
        tags: validatedData.tags,
        externalId: validatedData.externalId || null,
        externalUrl: validatedData.externalUrl || null,
        externalProvider: validatedData.externalProvider || null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(requirements.id, validatedData.id),
          eq(requirements.projectId, project.id)
        )
      );

    // Log audit event
    await logAuditEvent({
      userId,
      action: "requirement_updated",
      resource: "requirement",
      resourceId: validatedData.id,
      metadata: {
        organizationId,
        title: validatedData.title,
        priority: validatedData.priority,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

    revalidatePath("/requirements");

    return { success: true };
  } catch (error) {
    console.error("Error updating requirement:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
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

    // Check delete permission
    const canDelete = await hasPermission("requirement", "delete", {
      organizationId,
      projectId: project.id,
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

    // Verify requirement belongs to current project
    const existing = await db
      .select({ id: requirements.id, title: requirements.title })
      .from(requirements)
      .where(
        and(eq(requirements.id, id), eq(requirements.projectId, project.id))
      )
      .limit(1);

    if (existing.length === 0) {
      return {
        success: false,
        error: "Requirement not found",
      };
    }

    // Delete requirement (cascade handles snapshots and test links)
    await db.delete(requirements).where(eq(requirements.id, id));

    // Log audit event
    await logAuditEvent({
      userId,
      action: "requirement_deleted",
      resource: "requirement",
      resourceId: id,
      metadata: {
        organizationId,
        title: existing[0].title,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

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

    // Check delete permission
    const canDelete = await hasPermission("requirement", "delete", {
      organizationId,
      projectId: project.id,
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
          eq(requirements.projectId, project.id)
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

/**
 * Link tests to a requirement
 */
export async function linkTestsToRequirement(
  requirementId: string,
  testIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    // Check update permission
    const canUpdate = await hasPermission("requirement", "update", {
      organizationId,
      projectId: project.id,
    });

    if (!canUpdate) {
      return {
        success: false,
        error: "Insufficient permissions to link tests",
      };
    }

    if (testIds.length === 0) {
      return { success: true };
    }

    // Insert test-requirement links (ignore duplicates)
    await db
      .insert(testRequirements)
      .values(
        testIds.map((testId) => ({
          testId,
          requirementId,
          createdAt: new Date(),
        }))
      )
      .onConflictDoNothing();

    // Update coverage snapshot
    await updateCoverageSnapshot(requirementId);

    // Log audit event
    await logAuditEvent({
      userId,
      action: "requirement_tests_linked",
      resource: "requirement",
      resourceId: requirementId,
      metadata: {
        organizationId,
        testIds,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

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
 * Unlink a test from a requirement
 */
export async function unlinkTestFromRequirement(
  requirementId: string,
  testId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    // Check update permission
    const canUpdate = await hasPermission("requirement", "update", {
      organizationId,
      projectId: project.id,
    });

    if (!canUpdate) {
      return {
        success: false,
        error: "Insufficient permissions to unlink tests",
      };
    }

    // Delete the link
    await db
      .delete(testRequirements)
      .where(
        and(
          eq(testRequirements.testId, testId),
          eq(testRequirements.requirementId, requirementId)
        )
      );

    // Update coverage snapshot
    await updateCoverageSnapshot(requirementId);

    // Log audit event
    await logAuditEvent({
      userId,
      action: "requirement_test_unlinked",
      resource: "requirement",
      resourceId: requirementId,
      metadata: {
        organizationId,
        testId,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

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

/**
 * Update coverage snapshot for a requirement based on linked test results
 * This is called after linking/unlinking tests and by the coverage worker after job completion
 */
export async function updateCoverageSnapshot(
  requirementId: string
): Promise<void> {
  // Get linked tests with their latest run status
  const linkedTests = await db
    .select({
      testId: testRequirements.testId,
    })
    .from(testRequirements)
    .where(eq(testRequirements.requirementId, requirementId));

  const linkedTestCount = linkedTests.length;

  if (linkedTestCount === 0) {
    // No linked tests = missing coverage
    await db
      .update(requirementCoverageSnapshots)
      .set({
        status: "missing",
        linkedTestCount: 0,
        passedTestCount: 0,
        failedTestCount: 0,
        lastEvaluatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(requirementCoverageSnapshots.requirementId, requirementId));
    return;
  }

  // Get latest run status for each linked test
  // This is a simplified version - in production, you'd query the runs table
  // For now, set status based on linked test count
  await db
    .update(requirementCoverageSnapshots)
    .set({
      linkedTestCount,
      // Status will be computed by coverage worker after job runs
      lastEvaluatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(requirementCoverageSnapshots.requirementId, requirementId));
}

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
    const { project, organizationId } = await requireProjectContext();

    // Check view permission
    const canView = await hasPermission("requirement", "view", {
      organizationId,
      projectId: project.id,
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

    // Calculate totals
    let total = 0;
    let covered = 0;
    let failing = 0;
    let missing = 0;

    for (const stat of stats) {
      const count = Number(stat.count);
      total += count;
      if (stat.status === "covered") covered = count;
      else if (stat.status === "failing") failing = count;
      else missing = count; // null status also counts as missing
    }

    // Get at-risk count (P1/P2 with failing or missing coverage)
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
          // At-risk = high priority with failing or missing coverage
          eq(requirements.priority, "high"),
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
    const { project, organizationId } = await requireProjectContext();

    // Check view permission
    const canView = await hasPermission("requirement", "view", {
      organizationId,
      projectId: project.id,
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
        tags: requirements.tags,
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
      .where(
        and(eq(requirements.id, id), eq(requirements.projectId, project.id))
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const r = result[0];
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      priority: r.priority,
      tags: r.tags,
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
    const { project, organizationId } = await requireProjectContext();

    // Check view permission
    const canView = await hasPermission("requirement", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
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
      .innerJoin(tests, eq(testRequirements.testId, tests.id))
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
    const { project, organizationId } = await requireProjectContext();

    // Check view permission
    const canView = await hasPermission("requirement", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
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

    // Check view permission
    const canView = await hasPermission("requirement", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
      return { success: false, error: "Insufficient permissions" };
    }

    // Fetch all requirements with coverage (no pagination)
    const results = await db
      .select({
        id: requirements.id,
        title: requirements.title,
        description: requirements.description,
        priority: requirements.priority,
        tags: requirements.tags,
        externalId: requirements.externalId,
        externalUrl: requirements.externalUrl,
        coverageStatus: requirementCoverageSnapshots.status,
        linkedTestCount: requirementCoverageSnapshots.linkedTestCount,
        passedTestCount: requirementCoverageSnapshots.passedTestCount,
        failedTestCount: requirementCoverageSnapshots.failedTestCount,
        createdAt: requirements.createdAt,
      })
      .from(requirements)
      .leftJoin(
        requirementCoverageSnapshots,
        eq(requirements.id, requirementCoverageSnapshots.requirementId)
      )
      .where(eq(requirements.projectId, project.id))
      .orderBy(desc(requirements.createdAt));

    // CSV header
    const headers = [
      "ID",
      "Title",
      "Description",
      "Priority",
      "Status",
      "Tags",
      "Linked Tests",
      "Passed Tests",
      "Failed Tests",
      "External ID",
      "External URL",
      "Created At",
    ];

    // Helper to escape CSV values
    const escapeCSV = (value: string | null | undefined): string => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Build CSV rows
    const rows = results.map((r) => [
      escapeCSV(r.id),
      escapeCSV(r.title),
      escapeCSV(r.description),
      escapeCSV(r.priority ?? ""),
      escapeCSV(r.coverageStatus ?? "missing"),
      escapeCSV(r.tags),
      String(r.linkedTestCount ?? 0),
      String(r.passedTestCount ?? 0),
      String(r.failedTestCount ?? 0),
      escapeCSV(r.externalId),
      escapeCSV(r.externalUrl),
      r.createdAt ? r.createdAt.toISOString() : "",
    ]);

    // Combine header and rows
    const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join(
      "\n"
    );

    // Generate filename with project name and date
    const date = new Date().toISOString().split("T")[0];
    const safeProjectName = project.name
      .replace(/[^a-zA-Z0-9]/g, "_")
      .toLowerCase();
    const filename = `requirements_${safeProjectName}_${date}.csv`;

    // Audit log
    await logAuditEvent({
      userId,
      organizationId,
      action: "requirement_export",
      resource: "requirement",
      metadata: { count: results.length, format: "csv" },
      success: true,
    });

    return { success: true, csv, filename };
  } catch (error) {
    console.error("Error exporting requirements:", error);
    return { success: false, error: "Failed to export requirements" };
  }
}

