/**
 * Requirements service: the write/read logic shared by the server actions (UI)
 * and the REST routes (CLI). Deliberately NOT a "use server" module.
 *
 * Callers are responsible for authentication and RBAC permission checks.
 * Everything else lives here so both paths behave and audit identically:
 * validation, tenant scoping, tag/coverage sync and audit logging.
 * `revalidatePath` is NOT called here; only the actions do that.
 */
import { eq, and, desc, inArray } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
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
} from "@/db/schema";
import { db } from "@/utils/db";
import { httpUrlSchema } from "@/lib/requirements/http-url-schema";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  syncRequirementTags,
  syncRequirementTagsByName,
  updateCoverageSnapshot,
  type Executor,
} from "@/lib/requirements-internal";

// ============================================================================
// TYPES & SCHEMAS
// ============================================================================

export type RequirementServiceContext = {
  userId: string;
  organizationId: string;
  projectId: string;
  projectName: string;
};

const isTagLimitError = (error: unknown) => error instanceof Error && error.name === "TagLimitError";

export type ServiceFailureCode = "not_found" | "invalid" | "conflict";

export type ServiceResult = {
  success: boolean;
  error?: string;
  code?: ServiceFailureCode;
};

export const createRequirementSchema = requirementsInsertSchema
  .omit({
    id: true,
    organizationId: true,
    projectId: true,
    createdByUserId: true,
    createdAt: true,
    updatedAt: true,
  })
  // Optional client-chosen id: retrying a create whose response was lost then finds the row instead of duplicating it.
  .extend({
    id: z.string().uuid().optional(),
    externalUrl: httpUrlSchema.nullable().optional().or(z.literal("")),
  });

export const updateRequirementSchema = z.object({
  id: z.string().uuid(),
  // Only provided fields are written; the UI always sends a title.
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional().nullable(),
  priority: z.enum(["low", "medium", "high"]).optional().nullable(),
  tagIds: z.array(z.string().uuid()).optional(), // Array of tag IDs
  externalId: z.string().optional().nullable().or(z.literal("")),
  externalUrl: httpUrlSchema.optional().nullable().or(z.literal("")),
  externalProvider: z.string().optional().nullable().or(z.literal("")),
});

export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;
export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;

/** Upper bound on tests linked in one call; keeps queries and audit rows small. */
export const MAX_LINKED_TESTS_PER_REQUEST = 200;

const linkTestsSchema = z.object({
  requirementId: z.string().uuid(),
  testIds: z.array(z.string().uuid()).max(MAX_LINKED_TESTS_PER_REQUEST),
});

export type RequirementDto = {
  id: string;
  title: string;
  description: string | null;
  priority: RequirementPriority | null;
  tags: string[];
  externalId: string | null;
  externalUrl: string | null;
  testIds: string[];
  coverage: {
    status: string;
    linkedTestCount: number;
    passedTestCount: number;
    failedTestCount: number;
    lastEvaluatedAt: string | null;
  } | null;
  createdAt: string | null;
  updatedAt: string | null;
};

// ============================================================================
// SCOPE
// ============================================================================

/**
 * True when the requirement (and every given test) belongs to the caller's
 * project and organization. Every path that touches testRequirements must pass
 * this before reading or writing.
 */
export async function isInCallerScope(
  requirementId: string,
  testIds: string[],
  scope: { projectId: string; organizationId: string }
): Promise<boolean> {
  const [requirement] = await db
    .select({ id: requirements.id })
    .from(requirements)
    .where(
      and(
        eq(requirements.id, requirementId),
        eq(requirements.projectId, scope.projectId),
        eq(requirements.organizationId, scope.organizationId)
      )
    )
    .limit(1);
  if (!requirement) return false;

  const uniqueTestIds = Array.from(new Set(testIds));
  if (uniqueTestIds.length === 0) return true;

  const scopedTests = await db
    .select({ id: tests.id })
    .from(tests)
    .where(
      and(
        inArray(tests.id, uniqueTestIds),
        eq(tests.projectId, scope.projectId),
        eq(tests.organizationId, scope.organizationId)
      )
    );
  return scopedTests.length === uniqueTestIds.length;
}

/** True when every test id belongs to the caller's project and organization. */
export async function areTestsInScope(
  ctx: RequirementServiceContext,
  testIds: string[]
): Promise<boolean> {
  const unique = Array.from(new Set(testIds));
  if (unique.length === 0) return true;
  const scoped = await db
    .select({ id: tests.id })
    .from(tests)
    .where(
      and(
        inArray(tests.id, unique),
        eq(tests.projectId, ctx.projectId),
        eq(tests.organizationId, ctx.organizationId)
      )
    );
  return scoped.length === unique.length;
}

// ============================================================================
// CREATE
// ============================================================================

export async function createRequirementRecord(
  ctx: RequirementServiceContext,
  data: CreateRequirementInput,
  // `testIds` must already be scope-checked by the caller; they are linked inside the same transaction.
  options?: { tagNames?: string[]; testIds?: string[] }
): Promise<{ id: string; success: boolean; error?: string; code?: ServiceFailureCode }> {
  const { userId, organizationId, projectId, projectName } = ctx;
  const validatedData = createRequirementSchema.parse(data);
  const linkTestIds = Array.from(new Set(options?.testIds ?? []));
  if (validatedData.sourceDocumentId) {
    const [document] = await db
      .select({ id: requirementDocuments.id })
      .from(requirementDocuments)
      .where(
        and(
          eq(requirementDocuments.id, validatedData.sourceDocumentId),
          eq(requirementDocuments.projectId, projectId),
          eq(requirementDocuments.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!document) {
      return {
        id: "",
        success: false,
        error: "Source document not found in this project",
        code: "invalid",
      };
    }
  }
  const newId = validatedData.id ?? crypto.randomUUID();

  // The row, its tags and its initial coverage snapshot commit together: a failure part-way leaves nothing
  // behind, so a result of {success:false} always means "not created" and the caller can safely retry.
  let inserted: boolean;
  try {
    inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(requirements)
        .values({
          id: newId,
          organizationId,
          projectId,
          title: validatedData.title,
          description: validatedData.description,
          priority: validatedData.priority as RequirementPriority,
          sourceDocumentId: validatedData.sourceDocumentId,
          sourceSection: validatedData.sourceSection,
          externalId: validatedData.externalId,
          externalUrl: validatedData.externalUrl,
          externalProvider: validatedData.externalProvider,
          createdBy: (validatedData.createdBy as RequirementCreatedBy) ?? "user",
          createdByUserId: userId,
          createdAt: new Date(),
        })
        // Only the primary key means "already created"; any other unique violation must still fail and roll back.
        .onConflictDoNothing({ target: requirements.id })
        .returning({ id: requirements.id });
      if (!row) return false;

      // Sync tags if provided (explicit names, else the comma-separated string for backward compatibility)
      const tagNames =
        options?.tagNames ??
        (validatedData.tags
          ? // The comma-separated form has always created lowercase tags; keep that for the UI path.
            validatedData.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
          : []);
      if (tagNames.length > 0) {
        await syncRequirementTagsByName(newId, tagNames, organizationId, projectId, userId, tx);
      }

      // Create initial coverage snapshot (status: missing)
      await tx.insert(requirementCoverageSnapshots).values({
        requirementId: newId,
        status: "missing",
        linkedTestCount: 0,
        passedTestCount: 0,
        failedTestCount: 0,
        lastEvaluatedAt: new Date(),
      });

      // Linking is part of the create: a failure here rolls back the row, tags and snapshot too.
      if (linkTestIds.length > 0) {
        await insertTestLinks(tx, newId, linkTestIds);
        await updateCoverageSnapshot(newId, tx);
      }
      return true;
    });
  } catch (error) {
    if (isTagLimitError(error)) {
      return { id: "", success: false, error: (error as Error).message, code: "invalid" };
    }
    throw error;
  }

  if (!inserted) {
    // Only a client-supplied id can collide. The same id in this project means the earlier attempt committed
    // and only its response was lost; anywhere else it is someone else's row and must not be reported as ours.
    const [existing] = await db
      .select({ id: requirements.id })
      .from(requirements)
      .where(
        and(
          eq(requirements.id, newId),
          eq(requirements.organizationId, organizationId),
          eq(requirements.projectId, projectId)
        )
      )
      .limit(1);
    if (!existing) {
      return { id: "", success: false, error: "Requirement id is already in use", code: "conflict" };
    }
    return { id: newId, success: true };
  }

  await logAuditEvent({
    userId,
    action: "requirement_created",
    resource: "requirement",
    resourceId: newId,
    metadata: {
      organizationId,
      title: validatedData.title,
      priority: validatedData.priority,
      projectId,
      projectName,
    },
    success: true,
  });

  if (linkTestIds.length > 0) {
    await logAuditEvent({
      userId,
      action: "requirement_tests_linked",
      resource: "requirement",
      resourceId: newId,
      metadata: { organizationId, testIds: linkTestIds, projectId, projectName },
      success: true,
    });
  }

  return { id: newId, success: true };
}

// ============================================================================
// UPDATE
// ============================================================================

export async function updateRequirementRecord(
  ctx: RequirementServiceContext,
  data: UpdateRequirementInput,
  // `testIds` (when present) replaces the linked set; the caller must already have scope-checked them.
  options?: { tagNames?: string[]; testIds?: string[] }
): Promise<ServiceResult> {
  const { userId, organizationId, projectId, projectName } = ctx;
  const validatedData = updateRequirementSchema.parse(data);

  // Tag IDs come from the client: only accept tags from this project. Checked
  // before any write so a bad tag cannot leave a half-applied update.
  const uniqueTagIds =
    validatedData.tagIds !== undefined
      ? Array.from(new Set(validatedData.tagIds))
      : undefined;
  if (uniqueTagIds && uniqueTagIds.length > 0) {
    const scopedTags = await db
      .select({ id: tags.id })
      .from(tags)
      .where(
        and(
          inArray(tags.id, uniqueTagIds),
          eq(tags.projectId, projectId),
          eq(tags.organizationId, organizationId)
        )
      );
    if (scopedTags.length !== uniqueTagIds.length) {
      return {
        success: false,
        error: "One or more tags are invalid or not accessible",
        code: "invalid",
      };
    }
  }

  // Only columns present in the request are written, so concurrent edits to other fields are not clobbered.
  const changes: Partial<typeof requirements.$inferInsert> = { updatedAt: new Date() };
  if (validatedData.title !== undefined) changes.title = validatedData.title;
  if (validatedData.description !== undefined) changes.description = validatedData.description;
  if (validatedData.priority !== undefined) {
    changes.priority = validatedData.priority as RequirementPriority | null;
  }
  if (validatedData.externalId !== undefined) changes.externalId = validatedData.externalId || null;
  if (validatedData.externalUrl !== undefined) changes.externalUrl = validatedData.externalUrl || null;
  if (validatedData.externalProvider !== undefined) {
    changes.externalProvider = validatedData.externalProvider || null;
  }
  const linkTestIds = options?.testIds === undefined ? undefined : Array.from(new Set(options.testIds));

  // Row, tags and test links commit together; a failure part-way leaves the requirement untouched.
  let found: boolean;
  try {
    found = await db.transaction(async (tx) => {
      const updatedRequirements = await tx
        .update(requirements)
        .set(changes)
        .where(
          and(
            eq(requirements.id, validatedData.id),
            eq(requirements.projectId, projectId),
            eq(requirements.organizationId, organizationId)
          )
        )
        .returning({ id: requirements.id });
      if (updatedRequirements.length === 0) return false;

      if (uniqueTagIds !== undefined) {
        await syncRequirementTags(validatedData.id, uniqueTagIds, tx);
      } else if (options?.tagNames !== undefined) {
        if (options.tagNames.length === 0) {
          await syncRequirementTags(validatedData.id, [], tx);
        } else {
          await syncRequirementTagsByName(
            validatedData.id,
            options.tagNames,
            organizationId,
            projectId,
            userId,
            tx
          );
        }
      }

      if (linkTestIds !== undefined) {
        await replaceTestLinks(tx, validatedData.id, linkTestIds);
        await updateCoverageSnapshot(validatedData.id, tx);
      }
      return true;
    });
  } catch (error) {
    if (isTagLimitError(error)) {
      return { success: false, error: (error as Error).message, code: "invalid" };
    }
    throw error;
  }

  if (!found) {
    return {
      success: false,
      error: "Requirement not found or access denied",
      code: "not_found",
    };
  }

  await logAuditEvent({
    userId,
    action: "requirement_updated",
    resource: "requirement",
    resourceId: validatedData.id,
    metadata: {
      organizationId,
      title: validatedData.title,
      priority: validatedData.priority,
      projectId,
      projectName,
    },
    success: true,
  });

  if (linkTestIds !== undefined) {
    await logAuditEvent({
      userId,
      action: "requirement_tests_synced",
      resource: "requirement",
      resourceId: validatedData.id,
      metadata: {
        organizationId,
        testIds: linkTestIds,
        testCount: linkTestIds.length,
        projectId,
        projectName,
      },
      success: true,
    });
  }

  return { success: true };
}

// ============================================================================
// DELETE
// ============================================================================

export async function deleteRequirementRecord(
  ctx: RequirementServiceContext,
  id: string
): Promise<ServiceResult> {
  const { userId, organizationId, projectId, projectName } = ctx;

  const existing = await db
    .select({ id: requirements.id, title: requirements.title })
    .from(requirements)
    .where(
      and(
        eq(requirements.id, id),
        eq(requirements.projectId, projectId),
        eq(requirements.organizationId, organizationId)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    return { success: false, error: "Requirement not found", code: "not_found" };
  }

  // Cascade handles snapshots and test links
  await db.delete(requirements).where(eq(requirements.id, id));

  await logAuditEvent({
    userId,
    action: "requirement_deleted",
    resource: "requirement",
    resourceId: id,
    metadata: {
      organizationId,
      title: existing[0].title,
      projectId,
      projectName,
    },
    success: true,
  });

  return { success: true };
}

// ============================================================================
// TEST LINKS
// ============================================================================

/** Insert links, ignoring ones that already exist. Callers must have scope-checked the ids. */
async function insertTestLinks(executor: Executor, requirementId: string, testIds: string[]) {
  await executor
    .insert(testRequirements)
    .values(testIds.map((testId) => ({ testId, requirementId, createdAt: new Date() })))
    .onConflictDoNothing();
}

/** Replace the whole linked set. Callers must have scope-checked the ids. */
async function replaceTestLinks(executor: Executor, requirementId: string, testIds: string[]) {
  await executor.delete(testRequirements).where(eq(testRequirements.requirementId, requirementId));
  if (testIds.length > 0) await insertTestLinks(executor, requirementId, testIds);
}

export async function linkTestsRecord(
  ctx: RequirementServiceContext,
  requirementId: string,
  testIds: string[]
): Promise<ServiceResult> {
  const { userId, organizationId, projectId, projectName } = ctx;

  if (!linkTestsSchema.safeParse({ requirementId, testIds }).success) {
    return { success: false, error: "Invalid requirement or test IDs", code: "invalid" };
  }

  if (testIds.length === 0) {
    return { success: true };
  }

  if (!(await isInCallerScope(requirementId, testIds, { projectId, organizationId }))) {
    return {
      success: false,
      error: "Requirement or tests not found or access denied",
      code: "not_found",
    };
  }

  // Insert test-requirement links (ignore duplicates)
  await db.transaction(async (tx) => {
    await insertTestLinks(tx, requirementId, testIds);
    await updateCoverageSnapshot(requirementId, tx);
  });

  await logAuditEvent({
    userId,
    action: "requirement_tests_linked",
    resource: "requirement",
    resourceId: requirementId,
    metadata: {
      organizationId,
      testIds,
      projectId,
      projectName,
    },
    success: true,
  });

  return { success: true };
}

/**
 * Replace the full set of tests linked to a requirement and update coverage once.
 */
export async function syncRequirementTestsRecord(
  ctx: RequirementServiceContext,
  requirementId: string,
  testIds: string[]
): Promise<ServiceResult> {
  const { userId, organizationId, projectId, projectName } = ctx;

  const requirementRecord = await db
    .select({ id: requirements.id })
    .from(requirements)
    .where(
      and(
        eq(requirements.id, requirementId),
        eq(requirements.projectId, projectId),
        eq(requirements.organizationId, organizationId)
      )
    )
    .limit(1);

  if (requirementRecord.length === 0) {
    return {
      success: false,
      error: "Requirement not found or access denied",
      code: "not_found",
    };
  }

  const normalizedTestIds = Array.from(
    new Set(
      testIds.filter(
        (testId): testId is string =>
          typeof testId === "string" && testId.trim().length > 0
      )
    )
  );

  if (normalizedTestIds.length > 0) {
    const scopedTests = await db
      .select({ id: tests.id })
      .from(tests)
      .where(
        and(
          inArray(tests.id, normalizedTestIds),
          eq(tests.projectId, projectId),
          eq(tests.organizationId, organizationId)
        )
      );

    if (scopedTests.length !== normalizedTestIds.length) {
      return {
        success: false,
        error: "One or more selected tests are invalid or not accessible",
        code: "invalid",
      };
    }
  }

  await db.transaction(async (tx) => {
    await replaceTestLinks(tx, requirementId, normalizedTestIds);
    await updateCoverageSnapshot(requirementId, tx);
  });

  await logAuditEvent({
    userId,
    action: "requirement_tests_synced",
    resource: "requirement",
    resourceId: requirementId,
    metadata: {
      organizationId,
      testIds: normalizedTestIds,
      testCount: normalizedTestIds.length,
      projectId,
      projectName,
    },
    success: true,
  });

  return { success: true };
}

/**
 * Unlink one or more tests from a requirement (idempotent for tests that are
 * in scope but not linked). A single id audits `testId`, several audit `testIds`.
 */
export async function unlinkTestsRecord(
  ctx: RequirementServiceContext,
  requirementId: string,
  testIds: string[]
): Promise<ServiceResult> {
  const { userId, organizationId, projectId, projectName } = ctx;
  const uuid = z.string().uuid();

  if (
    !uuid.safeParse(requirementId).success ||
    testIds.length === 0 ||
    !testIds.every((id) => uuid.safeParse(id).success)
  ) {
    return {
      success: false,
      error: testIds.length > 1 ? "Invalid requirement or test IDs" : "Invalid requirement or test ID",
      code: "invalid",
    };
  }

  if (!(await isInCallerScope(requirementId, testIds, { projectId, organizationId }))) {
    return {
      success: false,
      error:
        testIds.length > 1
          ? "Requirement or tests not found or access denied"
          : "Requirement or test not found or access denied",
      code: "not_found",
    };
  }

  await db
    .delete(testRequirements)
    .where(
      and(
        inArray(testRequirements.testId, testIds),
        eq(testRequirements.requirementId, requirementId)
      )
    );

  await updateCoverageSnapshot(requirementId);

  await logAuditEvent({
    userId,
    action: "requirement_test_unlinked",
    resource: "requirement",
    resourceId: requirementId,
    metadata: {
      organizationId,
      ...(testIds.length === 1 ? { testId: testIds[0] } : { testIds }),
      projectId,
      projectName,
    },
    success: true,
  });

  return { success: true };
}

// ============================================================================
// READ (DTO)
// ============================================================================

export async function getRequirementDto(
  ctx: Pick<RequirementServiceContext, "organizationId" | "projectId">,
  id: string
): Promise<RequirementDto | null> {
  const [row] = await db
    .select({
      id: requirements.id,
      title: requirements.title,
      description: requirements.description,
      priority: requirements.priority,
      externalId: requirements.externalId,
      externalUrl: requirements.externalUrl,
      createdAt: requirements.createdAt,
      updatedAt: requirements.updatedAt,
      coverageStatus: requirementCoverageSnapshots.status,
      linkedTestCount: requirementCoverageSnapshots.linkedTestCount,
      passedTestCount: requirementCoverageSnapshots.passedTestCount,
      failedTestCount: requirementCoverageSnapshots.failedTestCount,
      lastEvaluatedAt: requirementCoverageSnapshots.lastEvaluatedAt,
    })
    .from(requirements)
    .leftJoin(
      requirementCoverageSnapshots,
      eq(requirements.id, requirementCoverageSnapshots.requirementId)
    )
    .where(
      and(
        eq(requirements.id, id),
        eq(requirements.projectId, ctx.projectId),
        eq(requirements.organizationId, ctx.organizationId)
      )
    )
    .limit(1);

  if (!row) return null;

  const [tagRows, linkRows] = await Promise.all([
    db
      .select({ name: tags.name })
      .from(requirementTags)
      .innerJoin(
        tags,
        and(eq(requirementTags.tagId, tags.id), eq(tags.projectId, ctx.projectId))
      )
      .where(eq(requirementTags.requirementId, id)),
    db
      .select({ testId: testRequirements.testId })
      .from(testRequirements)
      .where(eq(testRequirements.requirementId, id)),
  ]);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    tags: tagRows.map((t) => t.name),
    externalId: row.externalId,
    externalUrl: row.externalUrl,
    testIds: linkRows.map((l) => l.testId),
    coverage: row.coverageStatus
      ? {
          status: row.coverageStatus,
          linkedTestCount: row.linkedTestCount ?? 0,
          passedTestCount: row.passedTestCount ?? 0,
          failedTestCount: row.failedTestCount ?? 0,
          lastEvaluatedAt: row.lastEvaluatedAt?.toISOString() ?? null,
        }
      : null,
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

/** Tests linked to a requirement, or null when the requirement is not in scope. */
export async function listLinkedTestsRecord(
  ctx: Pick<RequirementServiceContext, "organizationId" | "projectId">,
  requirementId: string
): Promise<{ id: string; title: string; type: string }[] | null> {
  if (!(await isInCallerScope(requirementId, [], ctx))) return null;

  const rows = await db
    .select({ id: tests.id, title: tests.title, type: tests.type })
    .from(testRequirements)
    .innerJoin(
      tests,
      and(
        eq(testRequirements.testId, tests.id),
        eq(tests.projectId, ctx.projectId),
        eq(tests.organizationId, ctx.organizationId)
      )
    )
    .where(eq(testRequirements.requirementId, requirementId));

  return rows.map((t) => ({
    id: t.id,
    title: t.title ?? "Untitled",
    type: t.type ?? "unknown",
  }));
}

// ============================================================================
// EXPORT CSV
// ============================================================================

/**
 * Escape one CSV cell. Cells starting with = + - @ tab or CR are prefixed with a single quote so spreadsheets
 * do not evaluate them as formulas; values with separators, quotes or line breaks are quoted.
 */
export function escapeCSV(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (/[,"\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export async function exportRequirementsCsvRecord(
  ctx: RequirementServiceContext
): Promise<{ csv: string; filename: string; count: number }> {
  const { userId, organizationId, projectId, projectName } = ctx;

  const results = await db
    .select({
      id: requirements.id,
      title: requirements.title,
      description: requirements.description,
      priority: requirements.priority,
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
    .where(
      and(eq(requirements.projectId, projectId), eq(requirements.organizationId, organizationId))
    )
    .orderBy(desc(requirements.createdAt));

  const requirementIds = results.map((r) => r.id);
  const allTags =
    requirementIds.length > 0
      ? await db
          .select({
            requirementId: requirementTags.requirementId,
            tagName: tags.name,
          })
          .from(requirementTags)
          .innerJoin(
            tags,
            and(eq(requirementTags.tagId, tags.id), eq(tags.projectId, projectId))
          )
          .where(inArray(requirementTags.requirementId, requirementIds))
      : [];

  const tagsMap = new Map<string, string>();
  allTags.forEach(({ requirementId, tagName }) => {
    const existing = tagsMap.get(requirementId);
    tagsMap.set(requirementId, existing ? `${existing}, ${tagName}` : tagName);
  });

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

  const rows = results.map((r) => [
    escapeCSV(r.id),
    escapeCSV(r.title),
    escapeCSV(r.description),
    escapeCSV(r.priority ?? ""),
    escapeCSV(r.coverageStatus ?? "missing"),
    escapeCSV(tagsMap.get(r.id) ?? ""),
    String(r.linkedTestCount ?? 0),
    String(r.passedTestCount ?? 0),
    String(r.failedTestCount ?? 0),
    escapeCSV(r.externalId),
    escapeCSV(r.externalUrl),
    r.createdAt ? r.createdAt.toISOString() : "",
  ]);

  const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

  const date = new Date().toISOString().split("T")[0];
  const safeProjectName = projectName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const filename = `requirements_${safeProjectName}_${date}.csv`;

  await logAuditEvent({
    userId,
    organizationId,
    action: "requirement_export",
    resource: "requirement",
    metadata: { count: results.length, format: "csv" },
    success: true,
  });

  return { csv, filename, count: results.length };
}

// ============================================================================
// REST-FACING COMPOSITES (create/update with tag names and test links)
// ============================================================================

const tagNameSchema = z.string().trim().min(1).max(50);

const requirementBodyFields = {
  description: z.string().max(10000).nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).nullable().optional(),
  tags: z.array(tagNameSchema).max(10).optional(),
  externalId: z.string().max(255).nullable().optional(),
  externalUrl: httpUrlSchema.max(2048).nullable().optional().or(z.literal("")),
};

// Strict: an unknown key (typo, or a field the API does not support) is a 400 rather than silently ignored.
export const restCreateRequirementSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    ...requirementBodyFields,
    testIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict();

export const restUpdateRequirementSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    ...requirementBodyFields,
    testIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict();

export const restTestIdsSchema = z
  .object({
    testIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();

export type RestCreateRequirementInput = z.infer<typeof restCreateRequirementSchema>;
export type RestUpdateRequirementInput = z.infer<typeof restUpdateRequirementSchema>;

/** Case-insensitive dedupe that keeps the first spelling given (tag matching/creation is case-insensitive). */
const dedupeTagNames = (names: string[] | undefined) => {
  if (names === undefined) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
};

/** Create a requirement with optional tag names and linked tests. Linked tests are scope-checked before any write. */
export async function createRequirementWithRelations(
  ctx: RequirementServiceContext,
  input: RestCreateRequirementInput
): Promise<{ id: string; success: boolean; error?: string; code?: ServiceFailureCode }> {
  const testIds = Array.from(new Set(input.testIds ?? []));
  if (testIds.length > 0 && !(await areTestsInScope(ctx, testIds))) {
    return {
      id: "",
      success: false,
      error: "One or more tests are invalid or not accessible in this project",
      code: "invalid",
    };
  }

  // Test links are created inside the requirement's transaction, so a failed link leaves nothing behind.
  return createRequirementRecord(
    ctx,
    {
      title: input.title,
      description: input.description ?? undefined,
      priority: input.priority,
      externalId: input.externalId ?? undefined,
      externalUrl: input.externalUrl || undefined,
    } as CreateRequirementInput,
    { tagNames: dedupeTagNames(input.tags), testIds }
  );
}

/** Partially update a requirement. Omitted fields are preserved; `tags` / `testIds` when present replace the whole set. */
export async function updateRequirementWithRelations(
  ctx: RequirementServiceContext,
  id: string,
  patch: RestUpdateRequirementInput
): Promise<ServiceResult> {
  const testIds = patch.testIds === undefined ? undefined : Array.from(new Set(patch.testIds));
  if (testIds && testIds.length > 0 && !(await areTestsInScope(ctx, testIds))) {
    return {
      success: false,
      error: "One or more tests are invalid or not accessible in this project",
      code: "invalid",
    };
  }

  // Only the fields present in the body are written; `null` clears description/priority/externalId/externalUrl.
  return updateRequirementRecord(
    ctx,
    {
      id,
      title: patch.title,
      description: patch.description,
      priority: patch.priority,
      externalId: patch.externalId,
      externalUrl: patch.externalUrl,
    },
    { tagNames: dedupeTagNames(patch.tags), testIds }
  );
}

/** Build the service context from an AuthContext (`requireAuthContext()`). */
export function toServiceContext(auth: {
  userId: string;
  organizationId: string;
  project: { id: string; name: string };
}): RequirementServiceContext {
  return {
    userId: auth.userId,
    organizationId: auth.organizationId,
    projectId: auth.project.id,
    projectName: auth.project.name,
  };
}
