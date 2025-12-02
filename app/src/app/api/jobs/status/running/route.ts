import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/utils/db";
import { jobs, runs, JobStatus, TestRunStatus } from "@/db/schema";
import { getQueues } from "@/lib/queue";

/**
 * API endpoint to return all currently running jobs
 * Used by the JobContext to maintain state across page refreshes
 * 
 * Also verifies that DB status matches actual queue status and fixes inconsistencies
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Find all active runs first - only those with running status
    const activeRuns = await db.query.runs.findMany({
      where: eq(runs.status, "running"),
      columns: {
        id: true,
        jobId: true,
        startedAt: true
      }
    });
    
    // Only if we have active runs, verify their actual status in the queue
    if (activeRuns.length === 0) {
      return NextResponse.json({ runningJobs: [] });
    }

    // Get queue instances to check job status
    const { playwrightQueues, k6Queues } = await getQueues();
    const allQueues = [
      ...Object.values(playwrightQueues),
      ...Object.values(k6Queues)
    ];

    // ✅ OPTIMIZED: Parallel batch queries instead of N×M loop
    // For each run, check all queues in parallel using Promise.race
    // This finds the first queue that has the job, dramatically reducing query count
    const statusChecks = await Promise.all(
      activeRuns.map(async (run) => {
        let isActuallyRunning = false;

        // Check all queues in parallel and return as soon as we find the job
        try {
          await Promise.race([
            // Race all queues - whoever finds the job first wins
            ...allQueues.map(async (queue) => {
              const job = await queue.getJob(run.id);
              if (job) {
                const state = await job.getState();
                // Job is truly running if it's active or waiting
                if (state === 'active' || state === 'waiting' || state === 'delayed') {
                  isActuallyRunning = true;
                  // Throw to break the race - we found it!
                  throw new Error('FOUND');
                }
              }
            }),
            // Timeout after 2000ms to prevent hanging (increased for connection stability)
            new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 2000))
          ]);
        } catch (error) {
          // 'FOUND' error means we found the job running
          if (error instanceof Error && error.message === 'FOUND') {
            isActuallyRunning = true;
          }
          // Timeout or other errors mean job not found - treat as not running
        }

        return {
          runId: run.id,
          jobId: run.jobId,
          isActuallyRunning
        };
      })
    );

    // Separate valid and stale runs based on results
    // Only mark as stale if run started more than 60 minutes ago (max execution time)
    const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes - platform max execution time
    const staleRunIds: string[] = [];
    const validRunIds: string[] = [];

    for (const check of statusChecks) {
      if (check.isActuallyRunning) {
        validRunIds.push(check.runId);
      } else {
        // Only mark as stale if the run is older than the threshold
        const run = activeRuns.find(r => r.id === check.runId);
        const runAge = run?.startedAt ? Date.now() - new Date(run.startedAt).getTime() : 0;
        
        if (runAge > STALE_THRESHOLD_MS) {
          // Run exceeded max execution time and not in queue - truly stale
          staleRunIds.push(check.runId);
        } else {
          // Recent run not found in queue - likely transient issue, keep as valid
          validRunIds.push(check.runId);
        }
      }
    }

    // Fix stale runs in the database
    if (staleRunIds.length > 0) {
      console.log(`[JobStatus] Found ${staleRunIds.length} stale runs. Syncing with queue state...`);
      
      const staleJobIds = activeRuns
        .filter(run => staleRunIds.includes(run.id) && run.jobId)
        .map(run => run.jobId as string);

      // Update stale runs to error
      await db
        .update(runs)
        .set({
          status: "error" as TestRunStatus,
          completedAt: new Date(),
          errorDetails: "Job status inconsistency detected - not found in execution queue",
        })
        .where(inArray(runs.id, staleRunIds));

      // Update corresponding jobs to error
      if (staleJobIds.length > 0) {
        await db
          .update(jobs)
          .set({
            status: "error" as JobStatus,
            lastRunAt: new Date()
          })
          .where(inArray(jobs.id, staleJobIds));
      }
      
      console.log(`[JobStatus] Synced ${staleRunIds.length} stale runs to error status`);
    }
    
    // Extract job IDs from valid running runs
    const validRuns = activeRuns.filter(run => validRunIds.includes(run.id));
    const jobIds = [
      ...new Set(
        validRuns
          .map((run) => run.jobId)
          .filter((jobId): jobId is string => Boolean(jobId))
      ),
    ];

    if (jobIds.length === 0) {
      return NextResponse.json({ runningJobs: [] });
    }
    
    // Get job details for these active runs
    const jobsWithRuns = await Promise.all(
      jobIds.map(async (jobId) => {
        const job = await db.query.jobs.findFirst({
          where: eq(jobs.id, jobId),
          columns: {
            id: true,
            name: true,
            status: true
          }
        });
        
        // Match with run ID
        const run = validRuns.find(run => run.jobId === jobId);
        
        if (job && run) {
          return {
            jobId: job.id,
            name: job.name,
            runId: run.id
          };
        }
        return null;
      })
    );
    
    // Filter out null values and return
    const runningJobsData = jobsWithRuns.filter(Boolean);
    
    return NextResponse.json({ 
      runningJobs: runningJobsData 
    });
  } catch (error) {
    console.error("Error fetching running jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch running jobs" },
      { status: 500 }
    );
  }
} 
