import { eq, and, inArray } from "drizzle-orm";
import {
  requirementCoverageSnapshots,
  testRequirements,
  tags,
  requirementTags,
} from "@/db/schema";
import { db } from "@/utils/db";

// Either the shared pool or a transaction handle, so a caller can make the tag writes part of its own transaction.
type Executor = Pick<typeof db, "select" | "insert" | "delete">;

// Internal helpers: deliberately NOT in a "use server" module. Next.js exposes
// every export of a "use server" file as a client-callable endpoint, and these
// take raw IDs with no auth or tenant scoping. Callers must already be guarded.

/**
 * Sync tags for a requirement by replacing all existing tag associations.
 * Creates new tags in the centralized tags table if they don't exist.
 */
export async function syncRequirementTags(
  requirementId: string,
  tagIds: string[],
  executor: Executor = db
): Promise<void> {
  // Enforce maximum 10 tags per requirement (consistent with API route)
  if (tagIds.length > 10) {
    throw new Error("Maximum of 10 tags allowed per requirement");
  }

  // Delete existing tags for this requirement
  await executor
    .delete(requirementTags)
    .where(eq(requirementTags.requirementId, requirementId));

  // Insert new tags if any
  if (tagIds.length > 0) {
    await executor
      .insert(requirementTags)
      .values(
        tagIds.map((tagId) => ({
          requirementId,
          tagId,
          assignedAt: new Date(),
        }))
      )
      .onConflictDoNothing();
  }
}

/**
 * Sync tags from tag names (used by AI extraction).
 * Creates tags in centralized table if they don't exist,
 * then associates them with the requirement.
 */
export async function syncRequirementTagsByName(
  requirementId: string,
  tagNames: string[],
  organizationId: string,
  projectId: string,
  userId: string | null,
  executor: Executor = db
): Promise<void> {
  if (tagNames.length === 0) return;

  const normalizedNames = tagNames.map((name) => name.trim().toLowerCase());

  // Find existing tags
  const existingTags = await executor
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(
      and(
        eq(tags.projectId, projectId),
        inArray(tags.name, normalizedNames)
      )
    );

  const existingTagNames = new Set(existingTags.map((t) => t.name.toLowerCase()));
  const tagsToCreate = normalizedNames.filter((name) => !existingTagNames.has(name));

  // Create missing tags
  const newTags: { id: string; name: string }[] = [];
  if (tagsToCreate.length > 0) {
    const defaultColors = [
      "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
      "#06B6D4", "#84CC16", "#F97316", "#EC4899", "#6B7280",
    ];
    
    const createdTags = await executor
      .insert(tags)
      .values(
        tagsToCreate.map((name, i) => ({
          name,
          organizationId,
          projectId,
          createdByUserId: userId,
          color: defaultColors[i % defaultColors.length],
        }))
      )
      .returning({ id: tags.id, name: tags.name });
    
    newTags.push(...createdTags);
  }

  // Combine all tag IDs
  const allTagIds = [
    ...existingTags.map((t) => t.id),
    ...newTags.map((t) => t.id),
  ];

  // Sync requirement tags
  await syncRequirementTags(requirementId, allTagIds, executor);
}

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
