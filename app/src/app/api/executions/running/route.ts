import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { runs, jobs, projects, tests } from '@/db/schema';
import { eq, and, inArray, or } from 'drizzle-orm';
import { getQueues } from '@/lib/queue';
import { requireProjectContext } from '@/lib/project-context';
import { checkCapacityLimits } from '@/lib/middleware/plan-enforcement';
import type { Queue } from 'bullmq';

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

    // console.log(`[API] Querying database for running/queued runs in org ${organizationId}`);

    // Get capacity limits for this organization
    const capacityLimits = await checkCapacityLimits(organizationId);

    // Get all running and queued runs for this organization
    const activeRuns = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        status: runs.status,
        startedAt: runs.startedAt,
        metadata: runs.metadata,
        projectName: projects.name,
        location: runs.location, // Added location for correct queue lookup
      })
      .from(runs)
      .innerJoin(projects, eq(runs.projectId, projects.id))
      .where(
        and(
          eq(projects.organizationId, organizationId),
          or(
            eq(runs.status, 'running'),
            eq(runs.status, 'queued')
          )
        ),
      );

    // console.log(`[API] Found ${activeRuns.length} active runs in DB for org ${organizationId}`);

    // If no runs in DB, return empty immediately but with capacity info
    if (activeRuns.length === 0) {
      return NextResponse.json({
        running: [],
        queued: [],
        runningCapacity: capacityLimits.runningCapacity,
        queuedCapacity: capacityLimits.queuedCapacity,
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
          type: jobs.jobType,
          projectName: projects.name,
        })
        .from(jobs)
        .innerJoin(projects, eq(jobs.projectId, projects.id))
        .where(inArray(jobs.id, jobIds));

      jobMap = new Map(
        jobDetails.map((j) => [j.id, { name: j.name, type: j.type, projectName: j.projectName }]),
      );
    }

    // Verify against BullMQ queues to handle race conditions
    // (e.g. Job promoted to running in BullMQ but DB update pending/failed)
    const { playwrightQueues, k6Queues } = await getQueues();

    // Helper to get correct queue for a run
    const getQueueForRun = (
      jobType: 'playwright' | 'k6',
      location: string | null
    ): Queue | undefined => {
      if (jobType === 'playwright') {
        return playwrightQueues['global'];
      }
      return k6Queues[location || 'global'] || k6Queues['global'];
    };

    // Helper function to build execution item
    const buildExecutionItem = async (
      run: typeof activeRuns[0]
    ): Promise<ExecutionItem | null> => {
      let runId = run.id;
      let jobId = run.jobId;
      let jobName = '';
      let jobType: 'playwright' | 'k6' = 'playwright'; // Default
      let source: 'job' | 'playground' = 'job';
      let projectName = run.projectName;
      
      // Determine metadata
      if (jobId) {
        const jobDetail = jobMap.get(jobId);
        if (!jobDetail) return null; // Should not happen if referential integrity holds
        jobName = jobDetail.name;
        jobType = jobDetail.type as 'playwright' | 'k6';
        source = 'job';
        projectName = jobDetail.projectName || run.projectName; // Prefer job project name
      } else {
        // Playground/Ad-hoc
        const metadata = (run.metadata as Record<string, unknown>) || {};
        const testType = metadata.testType as string || 'browser';
        const testId = metadata.testId as string;
        
        jobType = testType === 'performance' ? 'k6' : 'playwright';
        source = (metadata.source === 'playground') ? 'playground' : 'job';
        
        // Try to determine name
        jobName = source === 'playground' ? 'Playground Execution' : 'Ad-hoc Execution';
        if (testId) {
           try {
             // Quick lookup (optimization: could be batched but this is rare)
             const test = await db.query.tests.findFirst({
               where: eq(tests.id, testId),
               columns: { title: true },
             });
             if (test?.title) jobName = test.title;
           } catch { /* ignore */ }
        }
      }

      // Check current status based on DB first
      let status: 'running' | 'queued' = run.status as 'running' | 'queued';
      let startedAt = run.startedAt;

      // Verify with BullMQ to detect if actually running
      // Only verify if DB says 'queued', because 'running' in DB is usually accurate (or leading)
      if (status === 'queued') {
        try {
          const queue = getQueueForRun(jobType, run.location);
          if (queue) {
            const job = await queue.getJob(runId);
            if (job) {
              const state = await job.getState();
              // If BullMQ says active, it IS running, regardless of what DB says
              if (state === 'active') {
                status = 'running';
                startedAt = new Date(job.processedOn || Date.now());
                console.log(`[API] Corrected status for ${runId}: queued -> running`);
              }
            }
          }
        } catch (e) {
          console.warn(`[API] Failed to check BullMQ status for ${runId}:`, e);
        }
      }

      return {
        runId,
        jobId,
        jobName,
        jobType,
        status,
        startedAt: status === 'running' ? startedAt : null,
        source,
        projectName,
      };
    };

    // Process all runs
    const runningItems: ExecutionItem[] = [];
    const queuedItems: ExecutionItem[] = [];

    for (const run of activeRuns) {
       const item = await buildExecutionItem(run);
       if (item) {
         if (item.status === 'running') {
           runningItems.push(item);
         } else {
           queuedItems.push(item);
         }
       }
    }

    // Assign queue positions
    let queuePosition = 1;
    // Sort queued items by creation time (FIFO) if not sorted by DB?
    // DB query didn't specify order, but usually insertion order. 
    // Let's assume CapacityManager's Redis Sorted Set is the REAL truth for order,
    // but matching that is complex. 
    // Approximation: Sort by ID (uuidv7 is time-sortable) or created_at (not selected).
    // Let's rely on runs.id (UUIDv7) which is time-ordered
    queuedItems.sort((a, b) => a.runId.localeCompare(b.runId));
    
    // Assign positions
    queuedItems.forEach(item => {
      item.queuePosition = queuePosition++;
    });

    return NextResponse.json({
      running: runningItems.sort((a, b) => {
        const aTime = a.startedAt?.getTime() || 0;
        const bTime = b.startedAt?.getTime() || 0;
        return bTime - aTime; // Most recent first
      }),
      queued: queuedItems.slice(0, 20), // Limit to 20 queued jobs
      runningCapacity: capacityLimits.runningCapacity,
      queuedCapacity: capacityLimits.queuedCapacity,
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

