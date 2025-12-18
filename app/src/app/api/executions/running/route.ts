import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { runs, jobs, projects } from '@/db/schema';
import { eq, and, inArray, or } from 'drizzle-orm';
import { requireProjectContext } from '@/lib/project-context';
import { checkCapacityLimits } from '@/lib/middleware/plan-enforcement';

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

    // PERFORMANCE OPTIMIZATION: Removed BullMQ queue verification
    // The DB status is the source of truth; SSE handles real-time updates
    // Previous code did O(n) Redis calls which caused 30+ second delays

    // Helper function to build execution item - now SYNCHRONOUS (no Redis calls)
    const buildExecutionItem = (
      run: typeof activeRuns[0]
    ): ExecutionItem | null => {
      const runId = run.id;
      const jobId = run.jobId;
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
        
        jobType = testType === 'performance' ? 'k6' : 'playwright';
        source = (metadata.source === 'playground') ? 'playground' : 'job';
        
        // Use simple name - no additional DB lookup needed
        jobName = source === 'playground' ? 'Playground Execution' : 'Ad-hoc Execution';
      }

      // Trust database status - SSE handles real-time updates
      const status: 'running' | 'queued' = run.status as 'running' | 'queued';
      const startedAt = run.startedAt;

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

    // Process all runs - now synchronous, no Redis calls
    const runningItems: ExecutionItem[] = [];
    const queuedItems: ExecutionItem[] = [];

    for (const run of activeRuns) {
       const item = buildExecutionItem(run);
       if (item) {
         if (item.status === 'running') {
           runningItems.push(item);
         } else {
           queuedItems.push(item);
         }
       }
    }

    // Assign queue positions using Redis sorted set (single source of truth for FIFO order)
    // The capacity manager stores queued jobs with timestamp scores for correct ordering
    let queuePosition = 1;
    
    try {
      const { getRedisConnection } = await import('@/lib/queue');
      const redis = await getRedisConnection();
      
      const queuedKey = `capacity:queued:${organizationId}`;
      
      // Get all job IDs from sorted set in order (oldest first = lowest timestamp score)
      const orderedJobIds = await redis.zrange(queuedKey, 0, -1);
      
      // Create a position map from Redis order
      const positionMap = new Map<string, number>();
      orderedJobIds.forEach((id, index) => {
        positionMap.set(id, index + 1);
      });
      
      // Sort queued items using Redis positions (FIFO order)
      queuedItems.sort((a, b) => {
        const posA = positionMap.get(a.runId) ?? Number.MAX_SAFE_INTEGER;
        const posB = positionMap.get(b.runId) ?? Number.MAX_SAFE_INTEGER;
        return posA - posB;
      });
      
      // Assign positions from Redis, with fallback for jobs not in sorted set
      let fallbackPosition = orderedJobIds.length + 1;
      queuedItems.forEach(item => {
        const redisPosition = positionMap.get(item.runId);
        if (redisPosition !== undefined) {
          item.queuePosition = redisPosition;
        } else {
          // Job not in Redis sorted set (edge case: already promoted or added via different path)
          item.queuePosition = fallbackPosition++;
        }
      });
    } catch (redisError) {
      // Fallback if Redis unavailable: use sequential positions (order may not be accurate)
      console.warn('[API] Failed to get Redis queue positions, using fallback:', redisError);
      queuedItems.forEach(item => {
        item.queuePosition = queuePosition++;
      });
    }

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

