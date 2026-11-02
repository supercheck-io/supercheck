import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/utils/db";
import { k6PerformanceRuns, runs, sreServiceResources, statusPageComponents, statusPages, trialSuspensions } from "@/db/schema";

// sre_service_resources.resource_id and trial_suspensions.resource_id point at several tables, so no
// foreign key can cascade them. Every delete path calls these inside its own transaction instead.
type Executor = Pick<typeof db, "delete" | "select">;

export async function removeServiceResourceLinks(
  tx: Executor,
  resourceType: "monitor" | "job" | "test" | "status_page_component",
  ids: string[],
) {
  if (ids.length === 0) return;
  await tx
    .delete(sreServiceResources)
    .where(and(eq(sreServiceResources.resourceType, resourceType), inArray(sreServiceResources.resourceId, ids)));
}

/** k6_run links point at k6_performance_runs, which cascade-delete with their run. */
export async function removeK6RunLinks(tx: Executor, runIds: string[]) {
  if (runIds.length === 0) return;
  await tx.delete(sreServiceResources).where(
    and(
      eq(sreServiceResources.resourceType, "k6_run"),
      inArray(
        sreServiceResources.resourceId,
        tx.select({ id: k6PerformanceRuns.id }).from(k6PerformanceRuns).where(inArray(k6PerformanceRuns.runId, runIds)),
      ),
    ),
  );
}

/** Same as removeK6RunLinks for every k6 result of a job, resolved inside the caller's transaction. */
export async function removeK6RunLinksForJob(tx: Executor, jobId: string) {
  await tx.delete(sreServiceResources).where(
    and(
      eq(sreServiceResources.resourceType, "k6_run"),
      inArray(
        sreServiceResources.resourceId,
        tx
          .select({ id: k6PerformanceRuns.id })
          .from(k6PerformanceRuns)
          .where(
            or(
              eq(k6PerformanceRuns.jobId, jobId),
              inArray(k6PerformanceRuns.runId, tx.select({ id: runs.id }).from(runs).where(eq(runs.jobId, jobId))),
            ),
          ),
      ),
    ),
  );
}

export async function removeTrialSuspensions(tx: Executor, resourceType: "monitor" | "status_page", ids: string[]) {
  if (ids.length === 0) return;
  await tx
    .delete(trialSuspensions)
    .where(and(eq(trialSuspensions.resourceType, resourceType), inArray(trialSuspensions.resourceId, ids)));
}

/** Delete a status page together with the links that cannot cascade (its components and its trial suspension). */
export async function deleteStatusPageWithLinks(statusPageId: string, organizationId: string, projectId: string) {
  const owned = and(
    eq(statusPages.id, statusPageId),
    eq(statusPages.organizationId, organizationId),
    eq(statusPages.projectId, projectId),
  );
  return db.transaction(async (tx) => {
    const [page] = await tx.select({ id: statusPages.id }).from(statusPages).where(owned).for("update");
    if (!page) return [];
    const components = await tx
      .select({ id: statusPageComponents.id })
      .from(statusPageComponents)
      .where(eq(statusPageComponents.statusPageId, page.id));
    await removeServiceResourceLinks(tx, "status_page_component", components.map((c) => c.id));
    await removeTrialSuspensions(tx, "status_page", [page.id]);
    return tx.delete(statusPages).where(owned).returning({ id: statusPages.id });
  });
}
