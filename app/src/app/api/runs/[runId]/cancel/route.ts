import { isSuperAdmin } from "@/lib/rbac/super-admin";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, jobs, member, projects } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getQueues } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";
import {
  calculateJobStatus,
  canCancelRun,
  type RunStatus,
} from "@/lib/job-status-utils";
import { canCancelRunInProject } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { setCancellationSignal, RUN_CANCELLATION_MARKER } from "@/lib/cancellation-service";
import { logAuditEvent } from "@/lib/audit-logger";
import { getCapacityManager } from "@/lib/capacity-manager";

const logger = createLogger({ module: "cancel-run-api" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

/**
 * POST /api/runs/[runId]/cancel
 *
 * Cancels a running test execution, job execution, or K6 test.
 *
 * Security:
 * - Requires authentication
 * - Verifies user has access to the run's organization/project
 * - Can only cancel runs in "running" or "pending" status
 *
 * Process:
 * 1. Validate user permissions
 * 2. Check run status (must be running or pending)
 * 3. Remove job from BullMQ queue
 * 4. Update run status to "cancelled"
 * 5. Update job status if applicable
 *
 * @param request - Next.js request object
 * @param params - Route params containing run ID
 * @returns JSON response with cancellation result
 */
/** BullMQ sets processedOn once a worker has picked a job up, even if it then moved the job back to the queue. */
function isHandedBack(job: { processedOn?: number | null }): boolean {
  return Boolean(job.processedOn);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  const params = await context.params;

  try {
    const runId = params.runId;

    // Require authentication (supports both Bearer tokens and session cookies)
    const { userId, isCliAuth, project: tokenProject } = await requireAuthContext();

    logger.info({ runId, userId }, "Cancellation requested");

    // Fetch the run with organization/project info for RBAC
    // Also fetch projectId directly from runs table for playground runs (which have no jobId)
    const runResult = await db
      .select({
        runId: runs.id,
        runStatus: runs.status,
        runErrorDetails: runs.errorDetails,
        runJobId: runs.jobId,
        runProjectId: runs.projectId,
        jobId: jobs.id,
        jobOrganizationId: jobs.organizationId,
        jobProjectId: jobs.projectId,
        jobName: jobs.name,
      })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .where(eq(runs.id, runId))
      .limit(1);

    const run = runResult[0];

    if (!run) {
      // A cancellation signal is a privileged cross-process command. Never
      // create one unless ownership can be established from a persisted run.
      logger.warn({ runId }, "Run not found");
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Determine if this is a playground run (no jobId but has projectId)
    const isPlaygroundRun = !run.jobId && run.runProjectId;

    // For playground runs, we need to get the organization from the project
    let organizationIdForRbac: string | null = null;

    if (isPlaygroundRun) {
      // Get organization from project for playground runs
      const projectResult = await db.query.projects.findFirst({
        where: eq(projects.id, run.runProjectId!),
        columns: { organizationId: true },
      });
      organizationIdForRbac = projectResult?.organizationId ?? null;
    } else if (run.jobId) {
      organizationIdForRbac = run.jobOrganizationId;
    }

    if (!organizationIdForRbac) {
      logger.warn({ runId }, "Cannot determine organization for run");
      return NextResponse.json(
        { error: "Cannot determine organization for this run" },
        { status: 400 }
      );
    }

    // RBAC: Verify user has access to this organization
    // Check if user is a member of the organization
    const superAdmin = await isSuperAdmin(userId);
    const orgMember = superAdmin ? null : await db.query.member.findFirst({
      where: and(
        eq(member.userId, userId),
        eq(member.organizationId, organizationIdForRbac)
      ),
    });

    if (!superAdmin && !orgMember) {
      logger.warn(
        { runId, userId, orgId: organizationIdForRbac },
        "Access denied - not a member of organization"
      );
      return NextResponse.json(
        {
          error: "Access denied - You don't have permission to cancel this run",
        },
        { status: 403 }
      );
    }

    // RBAC: Check if user has permission to cancel runs in this project
    const projectIdForRbac = run.runProjectId || run.jobProjectId;

    // Project-scoped CLI tokens may only act on their own project, even for super admins.
    if (isCliAuth && tokenProject?.id !== projectIdForRbac) {
      return NextResponse.json(
        { error: "Access denied - token is not scoped to this run's project" },
        { status: 403 }
      );
    }
    const canCancel = await canCancelRunInProject(
      userId,
      projectIdForRbac ?? null,
      organizationIdForRbac
    );

    if (!canCancel) {
      logger.warn(
        {
          runId,
          userId,
          orgId: organizationIdForRbac,
          projectId: projectIdForRbac,
        },
        "Access denied - insufficient permissions to cancel runs"
      );
      return NextResponse.json(
        {
          error:
            "Access denied - You don't have permission to cancel runs. Only editors and admins can cancel executions.",
        },
        { status: 403 }
      );
    }

    // A repeated cancel of an already-cancelled run is a no-op, not an error.
    if (run.runStatus === "error" && run.runErrorDetails === RUN_CANCELLATION_MARKER) {
      return NextResponse.json({
        success: true,
        message: "Run cancelled successfully",
        runId,
        queueRemoved: false,
        jobType: "unknown",
      });
    }

    // Check if run can be cancelled (must be running or pending)
    if (!canCancelRun(run.runStatus as RunStatus)) {
      logger.warn(
        { runId, status: run.runStatus },
        "Run cannot be cancelled - invalid status"
      );
      return NextResponse.json(
        {
          error:
            "Run cannot be cancelled. Only queued, running or pending runs can be cancelled.",
        },
        { status: 400 }
      );
    }

    // STEP 1: Set cancellation signal in Redis for the worker to detect
    // This must happen BEFORE any queue operations to ensure worker sees it
    try {
      await setCancellationSignal(runId);
      logger.info({ runId }, "Cancellation signal set in Redis");
    } catch (signalError) {
      logger.error(
        { error: signalError, runId },
        "Failed to persist cancellation signal"
      );
      return NextResponse.json(
        { error: "Could not request cancellation; please retry" },
        { status: 503 }
      );
    }

    // The marker is written before any queue work: if removing the job succeeds and a later step fails,
    // a retry must still find it, and a worker that claims the run in between is refused by it.
    try {
      await db
        .update(runs)
        .set({ errorDetails: RUN_CANCELLATION_MARKER })
        .where(and(eq(runs.id, runId), inArray(runs.status, ["queued", "running"])));
    } catch (markerError) {
      logger.error({ error: markerError, runId }, "Failed to persist the cancellation marker");
      return NextResponse.json(
        { error: "Could not request cancellation; please retry" },
        { status: 503 }
      );
    }

    // STEP 2: Try to remove from queue (works for waiting/delayed jobs)
    // Get the BullMQ queues
    const queues = await getQueues();

    // Determine which queue the job is in based on the run metadata
    let queueToSearch = null;
    let jobType = "unknown";

    // STEP 3: Update database status to "cancelled"
    // This happens in a transaction below after queue operations

    // Try to find and remove the job from BullMQ (only works for waiting/delayed jobs)
    // For active jobs, the worker will see the cancellation signal and stop
    let removedFromCapacityQueue = false;
    let jobWasRemoved = false; // Track if we successfully removed the job
    // A job a worker never picked up has no processedOn. One that was handed back
    // (capacity or active-execution deferral) may still have a live execution behind it.
    let removedJobNeverStarted = false;
    try {
      // Job IDs are the run IDs. Direct lookup is O(1) and avoids scanning all
      // active/waiting/delayed jobs for every cancellation request.
      const playwrightQueue = queues.playwrightQueues["global"];
      const playwrightJob = await playwrightQueue.getJob(runId);

      if (playwrightJob) {
          try {
            // A job a worker already picked up and handed back (capacity or active-execution deferral)
            // may have an execution behind it. Leave it in the queue: the worker re-checks, is refused
            // by the cancellation marker and finishes the run itself.
            if (isHandedBack(await playwrightQueue.getJob(runId) ?? playwrightJob)) {
              queueToSearch = "playwright-global";
              jobType = "playwright";
              logger.info({ runId, jobId: playwrightJob.id }, "Job was handed back by a worker; leaving it for the worker to finish");
            } else {
              await playwrightJob.remove();
              removedJobNeverStarted = true;
              queueToSearch = "playwright-global";
              jobType = "playwright";
              jobWasRemoved = true;
              logger.info(
                { runId, jobId: playwrightJob.id, queue: queueToSearch },
                "Removed job from BullMQ queue"
              );
            }
          } catch (removeError) {
            // Job is locked by worker - it's already running, can't remove from queue
            // This is expected - we'll just update the database status
            const errorMessage =
              removeError instanceof Error
                ? removeError.message
                : String(removeError);
            if (errorMessage.includes("locked")) {
              logger.warn(
                { runId, jobId: playwrightJob.id },
                "Job is locked by worker (already executing) - will update database status only"
              );
              queueToSearch = "playwright-global";
              jobType = "playwright";
              // jobWasRemoved remains false - worker will handle capacity release
            } else {
              throw removeError; // Re-throw unexpected errors
            }
          }
      }

      // If not found in Playwright, check K6 queues
      if (!queueToSearch) {
        for (const [region, k6Queue] of Object.entries(queues.k6Queues)) {
          const k6Job = await k6Queue.getJob(runId);
          if (k6Job) {
              try {
                if (isHandedBack(await k6Queue.getJob(runId) ?? k6Job)) {
                  queueToSearch = `k6-${region}`;
                  jobType = "k6";
                  logger.info({ runId, jobId: k6Job.id }, "Job was handed back by a worker; leaving it for the worker to finish");
                } else {
                  await k6Job.remove();
                  removedJobNeverStarted = true;
                  queueToSearch = `k6-${region}`;
                  jobType = "k6";
                  jobWasRemoved = true;
                  logger.info(
                    { runId, jobId: k6Job.id, queue: queueToSearch },
                    "Removed job from BullMQ queue"
                  );
                }
              } catch (removeError) {
                // Job is locked by worker - it's already running, can't remove from queue
                // This is expected - we'll just update the database status
                const errorMessage =
                  removeError instanceof Error
                    ? removeError.message
                    : String(removeError);
                if (errorMessage.includes("locked")) {
                  logger.warn(
                    { runId, jobId: k6Job.id },
                    "Job is locked by worker (already executing) - will update database status only"
                  );
                  queueToSearch = `k6-${region}`;
                  jobType = "k6";
                  // jobWasRemoved remains false - worker will handle capacity release
                } else {
                  throw removeError; // Re-throw unexpected errors
                }
              }
          }

          if (queueToSearch) break;
        }
      }

      // STEP 2.5: Check if job is in Redis capacity queue (not yet promoted to BullMQ)
      // Jobs can be in the queued set waiting to be promoted when capacity becomes available
      if (!queueToSearch && organizationIdForRbac) {
        try {
          const capacityManager = await getCapacityManager();
          const removedFromQueuedSet = await capacityManager.removeFromQueuedSet(organizationIdForRbac, runId);
          if (removedFromQueuedSet) {
            removedFromCapacityQueue = true;
            logger.info(
              { runId, organizationId: organizationIdForRbac },
              "Removed job from capacity queue (was waiting for promotion to BullMQ)"
            );
            jobType = "queued-pending";
            // Note: Queued jobs don't consume running capacity, only queued capacity
            // So we don't need to release a running slot here
          }
        } catch (queuedSetError) {
          logger.error(
            { error: queuedSetError, runId },
            "Failed to check Redis capacity queue"
          );
          // Continue - we'll still mark the job as cancelled in DB
        }
      }

      // Note: We don't throw error if job not found in queue
      // The run might have already started executing, so we just mark it as cancelled
      if (!queueToSearch && jobType === "unknown") {
        logger.warn(
          { runId },
          "Job not found in any queue - marking as cancelled anyway"
        );
      }

      // A locked job still consumes resources until the worker confirms terminal
      // completion. Release immediately only when BullMQ actually removed it.
      if (jobWasRemoved && organizationIdForRbac) {
        try {
          const capacityManager = await getCapacityManager();
          await capacityManager.releaseRunningSlot(organizationIdForRbac, runId);
          logger.info(
            { runId, organizationId: organizationIdForRbac, jobType, wasRemoved: jobWasRemoved },
            "Released capacity slot after removing queued BullMQ job"
          );
        } catch (capacityError) {
          logger.error(
            { error: capacityError, runId },
            "Failed to release capacity slot - may need manual reconciliation"
          );
          // Continue with cancellation even if capacity release fails
          // Reconciliation will eventually fix any drift
        }
      }
    } catch (queueError) {
      logger.error(
        { error: queueError, runId },
        "Error removing job from queue"
      );
      // Continue with cancellation even if queue removal fails
    }

    // Update run and job status in a transaction to ensure atomicity
    // Note: The worker will also update this when it detects the cancellation signal
    // The final status update from the worker will indicate actual cancellation completion
    const queueRemoved = jobWasRemoved || removedFromCapacityQueue;
    let cancellationComplete = false;
    const now = new Date();
    await db.transaction(async (tx) => {
      // The worker commits terminal status after its final artifact writes.
      await tx
        .update(runs)
        .set({
          errorDetails: RUN_CANCELLATION_MARKER,
        })
        .where(and(eq(runs.id, runId), inArray(runs.status, ["queued", "running"])));

      // The app marks a run running as soon as it hands it to BullMQ, so a waiting job's run is
      // usually "running" in the DB. Nothing else will ever finalize it once the job is gone.
      // A retry after an earlier attempt removed the job but failed before finishing finds the marker
      // already written and no job anywhere: nothing else will ever finalize the run.
      const earlierAttemptRemovedJob =
        run.runErrorDetails === RUN_CANCELLATION_MARKER && !queueToSearch && !removedFromCapacityQueue;
      if (removedFromCapacityQueue || (jobWasRemoved && removedJobNeverStarted) || earlierAttemptRemovedJob) {
        const finalized = await tx.update(runs).set({ status: "error", completedAt: now }).where(and(
          eq(runs.id, runId),
          inArray(runs.status, ["queued", "running"]),
          eq(runs.errorDetails, RUN_CANCELLATION_MARKER),
        )).returning({ id: runs.id });
        cancellationComplete = finalized.length > 0;
      }

      logger.info({ runId, cancellationComplete }, "Run cancellation recorded");

      // If this run belongs to a job, update the job status
      if (run.runJobId) {
        // Get all run statuses for this job
        const jobRuns = await tx.query.runs.findMany({
          where: eq(runs.jobId, run.runJobId),
          columns: {
            status: true,
          },
        });

        // Calculate job status using shared utility
        const runStatuses = jobRuns.map((r) => r.status as RunStatus);
        const jobStatus = calculateJobStatus(runStatuses);

        await tx
          .update(jobs)
          .set({ status: jobStatus })
          .where(eq(jobs.id, run.runJobId));

        logger.info(
          { runId, jobId: run.runJobId, jobStatus },
          "Updated job status after run cancellation"
        );
      }
    });

    // Log audit event for cancellation
    await logAuditEvent({
      userId,
      organizationId: organizationIdForRbac,
      action: "run_cancelled",
      resource: "run", // Standardized resource name
      resourceId: runId,
      metadata: {
        subtype: isPlaygroundRun ? "playground" : "job",
        jobId: run.runJobId || null,
        jobName: run.jobName || null,
        projectId: run.runProjectId || run.jobProjectId,
        jobType,
        queueRemoved,
        isPlaygroundRun,
      },
      success: true,
    });

    return NextResponse.json({
      success: true,
      message: cancellationComplete ? "Run cancelled successfully" : "Cancellation requested; waiting for execution to stop",
      runId,
      queueRemoved,
      jobType,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    logger.error({ error, runId: params.runId }, "Error cancelling run");

    return NextResponse.json(
      {
        error: "Failed to cancel run",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
