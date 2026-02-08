import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, jobs, member, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getQueues } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";
import {
  calculateJobStatus,
  canCancelRun,
  type RunStatus,
} from "@/lib/job-status-utils";
import { canCancelRunInProject } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { setCancellationSignal } from "@/lib/cancellation-service";
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
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  const params = await context.params;

  try {
    const runId = params.runId;

    // Require authentication (supports both Bearer tokens and session cookies)
    const { userId } = await requireAuthContext();

    logger.info({ runId, userId }, "Cancellation requested");

    // Fetch the run with organization/project info for RBAC
    // Also fetch projectId directly from runs table for playground runs (which have no jobId)
    const runResult = await db
      .select({
        runId: runs.id,
        runStatus: runs.status,
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
      // Run not found in database - could be a playground test
      // Try to set cancellation signal in Redis anyway
      logger.warn(
        { runId },
        "Run not found in database - attempting direct cancellation"
      );
      try {
        await setCancellationSignal(runId);
        logger.info(
          { runId },
          "Cancellation signal set for non-database run (likely playground)"
        );
        return NextResponse.json({
          success: true,
          message: "Run cancelled successfully",
          runId,
          queueRemoved: false,
          jobType: "playground",
        });
      } catch (signalError) {
        logger.error(
          { error: signalError, runId },
          "Failed to set cancellation signal for non-database run"
        );
        return NextResponse.json(
          { error: "Run not found and cancellation failed" },
          { status: 404 }
        );
      }
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
    const orgMember = await db.query.member.findFirst({
      where: and(
        eq(member.userId, userId),
        eq(member.organizationId, organizationIdForRbac)
      ),
    });

    if (!orgMember) {
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

    // Check if run can be cancelled (must be running or pending)
    if (!canCancelRun(run.runStatus as RunStatus)) {
      logger.warn(
        { runId, status: run.runStatus },
        "Run cannot be cancelled - invalid status"
      );
      return NextResponse.json(
        {
          error:
            "Run cannot be cancelled. Only running or pending runs can be cancelled.",
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
        "Failed to set cancellation signal - continuing anyway"
      );
      // Continue even if signal fails - we'll still update DB status
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
    let jobWasRemoved = false; // Track if we successfully removed the job
    try {
      // Check Playwright queue
      const playwrightQueue = queues.playwrightQueues["global"];
      const playwrightJobs = await playwrightQueue.getJobs([
        "active",
        "waiting",
        "delayed",
      ]);

      for (const job of playwrightJobs) {
        if (job.data.runId === runId) {
          try {
            await job.remove();
            queueToSearch = "playwright-global";
            jobType = "playwright";
            jobWasRemoved = true; // Job was successfully removed from queue
            logger.info(
              { runId, jobId: job.id, queue: queueToSearch },
              "Removed job from BullMQ queue"
            );
          } catch (removeError) {
            // Job is locked by worker - it's already running, can't remove from queue
            // This is expected - we'll just update the database status
            const errorMessage =
              removeError instanceof Error
                ? removeError.message
                : String(removeError);
            if (errorMessage.includes("locked")) {
              logger.warn(
                { runId, jobId: job.id },
                "Job is locked by worker (already executing) - will update database status only"
              );
              queueToSearch = "playwright-global";
              jobType = "playwright";
              // jobWasRemoved remains false - worker will handle capacity release
            } else {
              throw removeError; // Re-throw unexpected errors
            }
          }
          break;
        }
      }

      // If not found in Playwright, check K6 queues
      if (!queueToSearch) {
        for (const [region, k6Queue] of Object.entries(queues.k6Queues)) {
          const k6Jobs = await k6Queue.getJobs([
            "active",
            "waiting",
            "delayed",
          ]);

          for (const job of k6Jobs) {
            if (job.data.runId === runId) {
              try {
                await job.remove();
                queueToSearch = `k6-${region}`;
                jobType = "k6";
                jobWasRemoved = true; // Job was successfully removed from queue
                logger.info(
                  { runId, jobId: job.id, queue: queueToSearch },
                  "Removed job from BullMQ queue"
                );
              } catch (removeError) {
                // Job is locked by worker - it's already running, can't remove from queue
                // This is expected - we'll just update the database status
                const errorMessage =
                  removeError instanceof Error
                    ? removeError.message
                    : String(removeError);
                if (errorMessage.includes("locked")) {
                  logger.warn(
                    { runId, jobId: job.id },
                    "Job is locked by worker (already executing) - will update database status only"
                  );
                  queueToSearch = `k6-${region}`;
                  jobType = "k6";
                  // jobWasRemoved remains false - worker will handle capacity release
                } else {
                  throw removeError; // Re-throw unexpected errors
                }
              }
              break;
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

      // STEP 3.5: Release capacity slot if job was found in ANY queue
      // CRITICAL FIX: Release for BOTH removed jobs AND locked (running) jobs
      // For locked jobs, the worker will also try to release when it detects cancellation,
      // but releaseRunningSlot is now idempotent (uses atomic Lua script with released flag)
      // This prevents the race condition where user starts new job before worker stops
      if (queueToSearch && organizationIdForRbac) {
        try {
          const capacityManager = await getCapacityManager();
          await capacityManager.releaseRunningSlot(organizationIdForRbac, runId);
          logger.info(
            { runId, organizationId: organizationIdForRbac, jobType, wasRemoved: jobWasRemoved },
            "Released capacity slot (idempotent - safe if worker also releases)"
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
    const now = new Date();
    await db.transaction(async (tx) => {
      // Update run status to "cancelled"
      // Worker will see the cancellation signal and stop execution
      await tx
        .update(runs)
        .set({
          status: "error", // We use "error" status since "cancelled" isn't a valid status in schema
          completedAt: now,
          errorDetails: "Cancellation requested by user",
        })
        .where(eq(runs.id, runId));

      logger.info({ runId }, "Run status updated to cancelled");

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
        queueRemoved: !!queueToSearch,
        isPlaygroundRun,
      },
      success: true,
    });

    return NextResponse.json({
      success: true,
      message: "Run cancelled successfully",
      runId,
      queueRemoved: !!queueToSearch,
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
