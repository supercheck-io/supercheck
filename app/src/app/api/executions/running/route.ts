import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { runs, jobs, projects } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getQueues } from '@/lib/queue';
import { requireProjectContext } from '@/lib/project-context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ExecutionItem {
  runId: string;
  jobId: string | null;
  jobName: string;
  jobType: 'playwright' | 'k6';
  status: 'running' | 'queued';
  startedAt: Date | null;
  queuePosition?: number;
  source: 'job' | 'playground';
}

export async function GET() {
  try {
    // robustly get organizationId from project context
    const { organizationId } = await requireProjectContext();

    if (!organizationId) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 },
      );
    }

    // Get all running runs for this organization
    // Join with projects table since runs doesn't have organizationId directly
    const activeRuns = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        startedAt: runs.startedAt,
        metadata: runs.metadata,
      })
      .from(runs)
      .innerJoin(projects, eq(runs.projectId, projects.id))
      .where(
        and(
          eq(projects.organizationId, organizationId),
          eq(runs.status, 'running'),
        ),
      );

    console.log(`[API] Found ${activeRuns.length} running runs in DB for org ${organizationId}`);

    if (activeRuns.length === 0) {
      return NextResponse.json({
        running: [],
        queued: [],
      });
    }

    // Get job details for all active runs that have a jobId
    const jobIds = [
      ...new Set(activeRuns.map((r) => r.jobId).filter((id): id is string => id !== null)),
    ];

    let jobMap = new Map<string, { name: string; type: string }>();

    if (jobIds.length > 0) {
      const jobDetails = await db
        .select({
          id: jobs.id,
          name: jobs.name,
          type: jobs.jobType, // Correct property name from schema
        })
        .from(jobs)
        .where(inArray(jobs.id, jobIds));

      jobMap = new Map(
        jobDetails.map((j) => [j.id, { name: j.name, type: j.type }]),
      );
    }

    // Verify against BullMQ queues (reuse logic from /api/jobs/status/running)
    const { playwrightQueues, k6Queues } = await getQueues();
    const allQueues = [
      ...Object.values(playwrightQueues),
      ...Object.values(k6Queues),
    ];

    // Check each run against queues in parallel
    const verifiedRunning: ExecutionItem[] = [];

    await Promise.all(
      activeRuns.map(async (run) => {
        let foundState: string | null = null;

        // Check all queues in parallel and find if any match
        await Promise.all(
          allQueues.map(async (queue) => {
            try {
              const job = await queue.getJob(run.id);
              if (job) {
                const state = await job.getState();
                // Only 'active' means the job is actually running
                // 'waiting' and 'delayed' are queued states, not running
                if (state === 'active') {
                  foundState = state;
                  console.log(`[API] Run ${run.id} found in queue ${queue.name} with state: ${state}`);
                }
              }
            } catch {
              // Ignore errors from individual queue checks
            }
          })
        );

        // If found in queue OR if it's a playground run (which might be short-lived but we trust DB status for now if queue check fails? 
        // No, we should still rely on queue check to avoid stuck runs. 
        // But for playground runs, we need to extract info from metadata if jobId is null.
        
        if (foundState) {
          if (run.jobId) {
            // It's a Job run
            const jobDetail = jobMap.get(run.jobId);
            if (jobDetail) {
              verifiedRunning.push({
                runId: run.id,
                jobId: run.jobId,
                jobName: jobDetail.name,
                jobType: jobDetail.type as 'playwright' | 'k6',
                status: 'running',
                startedAt: run.startedAt,
                source: 'job',
              });
            } else {
              console.log(`[API] Run ${run.id} is running but job details not found for jobId ${run.jobId}`);
            }
          } else {
            // It's a Playground run (or other ad-hoc run)
            const metadata = (run.metadata as Record<string, unknown>) || {};
            const isPlayground = metadata.source === 'playground';
            const testType = metadata.testType || 'playwright'; // Default to playwright if unknown
            
            verifiedRunning.push({
              runId: run.id,
              jobId: null,
              jobName: isPlayground ? 'Playground Execution' : 'Ad-hoc Execution',
              jobType: testType as 'playwright' | 'k6',
              status: 'running',
              startedAt: run.startedAt,
              source: isPlayground ? 'playground' : 'job', // Default to job if not explicitly playground
            });
          }
        } else {
            console.log(`[API] Run ${run.id} failed verification. Found state: ${foundState}`);
        }
      }),
    );

    // Get queued jobs from BullMQ waiting lists
    const queuedJobs: ExecutionItem[] = [];

    // Check all waiting queues
    for (const queue of allQueues) {
      try {
        const waitingJobs = await queue.getWaiting(0, 50); // Get up to 50 queued jobs

        for (let i = 0; i < waitingJobs.length; i++) {
          const bullJob = waitingJobs[i];
          const jobData = bullJob.data;

          // Only include jobs from this organization
          if (jobData.organizationId !== organizationId) {
            continue;
          }

          // Get job details
          const jobDetail = jobMap.get(jobData.jobId);
          if (jobDetail) {
            queuedJobs.push({
              runId: bullJob.id as string,
              jobId: jobData.jobId,
              jobName: jobDetail.name,
              jobType: jobDetail.type as 'playwright' | 'k6',
              status: 'queued',
              startedAt: null,
              queuePosition: i + 1,
              source: 'job',
            });
          }
        }
      } catch (error) {
        console.error(`Error checking queue ${queue.name}:`, error);
      }
    }

    return NextResponse.json({
      running: verifiedRunning.sort((a, b) => {
        const aTime = a.startedAt?.getTime() || 0;
        const bTime = b.startedAt?.getTime() || 0;
        return bTime - aTime; // Most recent first
      }),
      queued: queuedJobs.slice(0, 20), // Limit to 20 queued jobs
    });
  } catch (error) {
    console.error('Error fetching running/queued executions:', error);
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
