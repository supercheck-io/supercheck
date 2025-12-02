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
  projectName?: string;
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
        projectName: projects.name,
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

    let jobMap = new Map<string, { name: string; type: string; projectName?: string }>();

    if (jobIds.length > 0) {
      const jobDetails = await db
        .select({
          id: jobs.id,
          name: jobs.name,
          type: jobs.jobType, // Correct property name from schema
          projectName: projects.name,
        })
        .from(jobs)
        .innerJoin(projects, eq(jobs.projectId, projects.id))
        .where(inArray(jobs.id, jobIds));

      jobMap = new Map(
        jobDetails.map((j) => [j.id, { name: j.name, type: j.type, projectName: j.projectName }]),
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
    const queuedFromDb: ExecutionItem[] = []; // Runs that are in DB as 'running' but in BullMQ as 'waiting'

    console.log(`[API] Checking ${activeRuns.length} runs against ${allQueues.length} queues`);

    // Helper function to build execution item from run data
    const buildExecutionItem = async (
      run: typeof activeRuns[0],
      status: 'running' | 'queued',
      queuePosition?: number
    ): Promise<ExecutionItem | null> => {
      if (run.jobId) {
        // It's a Job run
        const jobDetail = jobMap.get(run.jobId);
        if (jobDetail) {
          return {
            runId: run.id,
            jobId: run.jobId,
            jobName: jobDetail.name,
            jobType: jobDetail.type as 'playwright' | 'k6',
            status,
            startedAt: status === 'running' ? run.startedAt : null,
            queuePosition,
            source: 'job',
            projectName: run.projectName,
          };
        }
        return null;
      } else {
        // It's a Playground run (or other ad-hoc run)
        const metadata = (run.metadata as Record<string, unknown>) || {};
        const isPlayground = metadata.source === 'playground';
        const testType = metadata.testType as string || 'browser';
        const testId = metadata.testId as string;
        
        // Map test types to execution engines
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
              displayName = test.title;
            }
          } catch {
            // Keep default name on error
          }
        }
        
        return {
          runId: run.id,
          jobId: null,
          jobName: displayName,
          jobType,
          status,
          startedAt: status === 'running' ? run.startedAt : null,
          queuePosition,
          source: isPlayground ? 'playground' : 'job',
          projectName: run.projectName,
        };
      }
    };

    await Promise.all(
      activeRuns.map(async (run) => {
        let foundState: string | null = null;

        console.log(`[API] Checking run ${run.id}, jobId: ${run.jobId}, metadata:`, run.metadata);

        // Check all queues in parallel and find if any match
        await Promise.all(
          allQueues.map(async (queue) => {
            try {
              const job = await queue.getJob(run.id);
              if (job) {
                const state = await job.getState();
                console.log(`[API] Run ${run.id} found in queue ${queue.name} with state: ${state}`);
                // Track both 'active' and 'waiting'/'delayed' states
                if (state === 'active') {
                  foundState = 'active';
                } else if ((state === 'waiting' || state === 'delayed') && foundState !== 'active') {
                  foundState = state;
                }
              }
            } catch (error) {
              console.log(`[API] Error checking run ${run.id} in queue ${queue.name}:`, error);
            }
          })
        );

        console.log(`[API] Run ${run.id} verification result: foundState=${foundState}`);

        if (foundState === 'active') {
          const item = await buildExecutionItem(run, 'running');
          if (item) {
            console.log(`[API] Adding run ${run.id} to verified running list`);
            verifiedRunning.push(item);
          }
        } else if (foundState === 'waiting' || foundState === 'delayed') {
          const item = await buildExecutionItem(run, 'queued');
          if (item) {
            console.log(`[API] Adding run ${run.id} to queued list (DB status=running, BullMQ state=${foundState})`);
            queuedFromDb.push(item);
          }
        } else {
          // IMPORTANT: Trust the database - if DB says running but not in queue,
          // it's likely still running (BullMQ lookup can be unreliable after page refresh)
          // Only exclude if the run was started more than 5 minutes ago and not in queue
          const runAge = run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : 0;
          const isRecentRun = runAge < 5 * 60 * 1000; // Less than 5 minutes old
          
          if (isRecentRun || !run.startedAt) {
            // Trust DB for recent runs or runs without startedAt
            const item = await buildExecutionItem(run, 'running');
            if (item) {
              console.log(`[API] Adding run ${run.id} to running list (trusting DB - recent run or no startedAt)`);
              verifiedRunning.push(item);
            }
          } else {
            console.log(`[API] Run ${run.id} not found in queue and older than 5 minutes - skipping`);
          }
        }
      }),
    );

    // Get queued jobs from BullMQ waiting lists
    const queuedJobs: ExecutionItem[] = [];

    // Track run IDs we've already added from DB check to avoid duplicates
    const queuedRunIds = new Set(queuedFromDb.map(item => item.runId));

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

          // Skip if we already added this run from DB check
          if (queuedRunIds.has(bullJob.id as string)) {
            continue;
          }

          if (jobData.jobId) {
            // It's a Job run - use existing logic
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
                projectName: jobDetail.projectName,
              });
            }
          } else {
            // It's a Playground run (no jobId) - handle K6 and Playwright
            const isK6Queue = queue.name.startsWith('k6-');
            const jobType: 'playwright' | 'k6' = isK6Queue ? 'k6' : 'playwright';
            
            // Try to get test name
            let displayName = 'Playground Execution';
            const testId = jobData.testId;
            if (testId) {
              try {
                const test = await db.query.tests.findFirst({
                  where: eq(tests.id, testId),
                  columns: { title: true },
                });
                if (test?.title) {
                  displayName = test.title;
                }
              } catch {
                // Keep default name on error
              }
            }
            
            // Get project name
            let projectName: string | undefined;
            if (jobData.projectId) {
              try {
                const project = await db.query.projects.findFirst({
                  where: eq(projects.id, jobData.projectId),
                  columns: { name: true },
                });
                projectName = project?.name;
              } catch {
                // Keep undefined on error
              }
            }
            
            queuedJobs.push({
              runId: bullJob.id as string,
              jobId: null,
              jobName: displayName,
              jobType,
              status: 'queued',
              startedAt: null,
              queuePosition: i + 1,
              source: 'playground',
              projectName,
            });
          }
        }
      } catch (error) {
        console.error(`Error checking queue ${queue.name}:`, error);
      }
    }

    // Merge queued from DB (runs with status='running' but BullMQ state='waiting')
    // with queued from BullMQ waiting list
    const allQueued = [...queuedFromDb, ...queuedJobs];

    return NextResponse.json({
      running: verifiedRunning.sort((a, b) => {
        const aTime = a.startedAt?.getTime() || 0;
        const bTime = b.startedAt?.getTime() || 0;
        return bTime - aTime; // Most recent first
      }),
      queued: allQueued.slice(0, 20), // Limit to 20 queued jobs
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
