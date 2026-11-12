import { liveRunOfLiveJob } from "@/lib/deletion/visibility";
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import {
  requirementCoverageSnapshots,
  testRequirements,
  tags,
  requirementTags,
  jobTests,
  runs,
} from "@/db/schema";
import { computeCoverageStatus } from "@/lib/requirements/coverage-status";
import { RUN_CANCELLATION_MARKER } from "@/lib/run-cancellation-marker";
import { db } from "@/utils/db";

// Either the shared pool or a transaction handle, so a caller can make the tag writes part of its own transaction.
export type Executor = Pick<typeof db, "select" | "selectDistinctOn" | "selectDistinct" | "insert" | "delete" | "update">;

/** Raised when a requirement would exceed the tag cap; services map it to a validation failure (not a 500). */
export class TagLimitError extends Error {
  constructor() {
    super("Maximum of 10 tags allowed per requirement");
    this.name = "TagLimitError";
  }
}

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
    throw new TagLimitError();
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

  // "AI" and "ai" are one tag (two rows differing only in case would collide), so dedupe case-insensitively and
  // keep the first spelling given for any tag that has to be created.
  const seen = new Set<string>();
  const requestedNames: string[] = [];
  for (const raw of tagNames) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    requestedNames.push(name);
  }

  // Match existing tags case-insensitively so "Smoke" reuses the stored "smoke" (or "Smoke") instead of adding a twin.
  const existingTags =
    requestedNames.length === 0
      ? []
      : await executor
          .select({ id: tags.id, name: tags.name })
          .from(tags)
          .where(
            and(
              eq(tags.projectId, projectId),
              inArray(
                sql`lower(${tags.name})`,
                requestedNames.map((name) => name.toLowerCase())
              )
            )
          )
          .orderBy(asc(tags.createdAt), asc(tags.id));

  // Link ONE tag per requested name (legacy projects may hold case-twins): the exact-case match if any,
  // otherwise the oldest (rows arrive ordered by createdAt, id).
  const linkedExisting: { id: string; name: string }[] = [];
  for (const requested of requestedNames) {
    const candidates = existingTags.filter((t) => t.name.toLowerCase() === requested.toLowerCase());
    const pick = candidates.find((t) => t.name === requested) ?? candidates[0];
    if (pick) linkedExisting.push(pick);
  }

  const existingTagNames = new Set(linkedExisting.map((t) => t.name.toLowerCase()));
  const tagsToCreate = requestedNames.filter((name) => !existingTagNames.has(name.toLowerCase()));

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
    ...linkedExisting.map((t) => t.id),
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
  requirementId: string,
  executor: Executor = db
): Promise<void> {
  // The recompute reads, then writes. Run on the shared pool, two concurrent recomputes (for example
  // two run deletions) could each write from stale inputs, so take the snapshot row lock first: the
  // second waits, then reads inputs that include the first one's committed changes.
  if (executor === db) {
    return db.transaction((tx) => recomputeCoverageSnapshot(requirementId, tx as unknown as Executor));
  }
  return recomputeCoverageSnapshot(requirementId, executor);
}

async function recomputeCoverageSnapshot(requirementId: string, executor: Executor): Promise<void> {
  await executor
    .select({ requirementId: requirementCoverageSnapshots.requirementId })
    .from(requirementCoverageSnapshots)
    .where(eq(requirementCoverageSnapshots.requirementId, requirementId))
    .for("update");

  // One statement, so the link set and the run statuses cannot drift apart between reads. Same rule as
  // the worker's getLinkedTestsWithStatus: a test's status is its latest terminal job run (runs.id breaks ties).
  const linkedTests = await executor
    .selectDistinctOn([testRequirements.testId], {
      testId: testRequirements.testId,
      // A job run records per-test outcomes in metadata.testStatuses; older and k6 runs use the run status.
      status: sql<string | null>`coalesce(${runs.metadata}->'testStatuses'->>${testRequirements.testId}::text, ${runs.status})`,
    })
    .from(testRequirements)
    .leftJoin(jobTests, eq(jobTests.testId, testRequirements.testId))
    .leftJoin(
      runs,
      // A cancelled run is stored as "error" but has no test outcomes, so it must not decide coverage.
      and(
        eq(runs.jobId, jobTests.jobId),
        liveRunOfLiveJob(runs.jobId),
        inArray(runs.status, ["passed", "failed", "error"]),
        sql`${runs.errorDetails} is distinct from ${RUN_CANCELLATION_MARKER}`
      )
    )
    .where(eq(testRequirements.requirementId, requirementId))
    .orderBy(testRequirements.testId, sql`${runs.completedAt} desc nulls last`, desc(runs.id));

  const linkedTestCount = linkedTests.length;

  if (linkedTestCount === 0) {
    // No linked tests = missing coverage
    await executor
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

  const passedTestCount = linkedTests.filter((r) => r.status === "passed").length;
  const failedTestCount = linkedTests.filter((r) => r.status === "failed" || r.status === "error").length;

  await executor
    .update(requirementCoverageSnapshots)
    .set({
      status: computeCoverageStatus(linkedTestCount, passedTestCount, failedTestCount),
      linkedTestCount,
      passedTestCount,
      failedTestCount,
      lastEvaluatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(requirementCoverageSnapshots.requirementId, requirementId));
}

/** Recompute every requirement linked to a test in the job (after a run is cancelled or deleted). */
export async function updateCoverageSnapshotsForJob(jobId: string, executor: Executor = db): Promise<void> {
  const rows = await executor
    .selectDistinct({ requirementId: testRequirements.requirementId })
    .from(testRequirements)
    .innerJoin(jobTests, eq(jobTests.testId, testRequirements.testId))
    .where(eq(jobTests.jobId, jobId))
    // A fixed order keeps the snapshot locks taken inside one transaction deadlock-free.
    .orderBy(testRequirements.requirementId);
  for (const { requirementId } of rows) await updateCoverageSnapshot(requirementId, executor);
}
