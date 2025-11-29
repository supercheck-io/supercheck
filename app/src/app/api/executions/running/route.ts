import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { runs, jobs, projects, tests } from '@/db/schema';
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

    console.log(`[API] Querying database for running runs in org ${organizationId}`);

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
    if (activeRuns.length > 0) {
      console.log('[API] Active runs:', activeRuns.map(r => ({
        id: r.id,
        jobId: r.jobId,
        metadata: r.metadata,
        startedAt: r.startedAt
      })));
    }

    if (activeRuns.length === 0) {
      console.log('[API] No running runs found, returning empty arrays');
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

    console.log(`[API] Checking ${activeRuns.length} runs against ${allQueues.length} queues`);

    await Promise.all(
      activeRuns.map(async (run) => {
        let foundState: string | null = null;
        let foundQueueName: string | null = null;

        console.log(`[API] Checking run ${run.id}, jobId: ${run.jobId}, metadata:`, run.metadata);

        // Check all queues in parallel and find if any match
        await Promise.all(
          allQueues.map(async (queue) => {
            try {
              const job = await queue.getJob(run.id);
              if (job) {
                const state = await job.getState();
                console.log(`[API] Run ${run.id} found in queue ${queue.name} with state: ${state}`);
                // Only 'active' means the job is actually running
                // 'waiting' and 'delayed' are queued states, not running
                if (state === 'active') {
                  foundState = state;
                  foundQueueName = queue.name;
                }
              }
            } catch (error) {
              // Ignore errors from individual queue checks
              console.log(`[API] Error checking run ${run.id} in queue ${queue.name}:`, error);
            }
          })
        );

        console.log(`[API] Run ${run.id} verification result: foundState=${foundState}, foundQueueName=${foundQueueName}`);

        if (foundState) {
          if (run.jobId) {
            // It's a Job run
            const jobDetail = jobMap.get(run.jobId);
            if (jobDetail) {
              console.log(`[API] Adding Job run ${run.id} to verified list`);
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
            const testType = metadata.testType as string || 'browser';
            const testId = metadata.testId as string;
            
            console.log(`[API] Processing playground/ad-hoc run ${run.id}: isPlayground=${isPlayground}, testType=${testType}, testId=${testId}`);
            
            // Map test types to execution engines
            // browser, api, database, custom -> playwright
            // performance -> k6
            const jobType: 'playwright' | 'k6' = testType === 'performance' ? 'k6' : 'playwright';
            
            // Try to fetch test name from tests table if we have a testId
            let displayName = isPlayground ? 'Playground Execution' : 'Ad-hoc Execution';
            if (testId) {
              try {
                const test = await db.query.tests.findFirst({
                  where: eq(tests.id, testId),
                  columns: { title: true },
                });
                if (test?.title) {
                  // Show full test name
                  displayName = test.title;
                } else {
                  // Test not found or has no title, use full testId as fallback
                  displayName = testId;
                }
              } catch (error) {
                console.log(`[API] Could not fetch test name for testId ${testId}:`, error);
                // Use full testId as fallback if name fetch fails
                displayName = testId;
              }
            }
            
            console.log(`[API] Adding playground run ${run.id} to verified list with jobType=${jobType}, name=${displayName}`);
            verifiedRunning.push({
              runId: run.id,
              jobId: null,
              jobName: displayName,
              jobType,
              status: 'running',
              startedAt: run.startedAt,
              source: isPlayground ? 'playground' : 'job',
            });
          }
        } else {
          console.log(`[API] Run ${run.id} failed verification - not found in any queue with active state`);
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
