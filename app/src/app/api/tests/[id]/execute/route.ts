import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { tests, runs, type K6Location } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';
import { Queue } from 'bullmq';
import { validateK6Script } from '@/lib/k6-validator';
import { randomUUID } from 'crypto';

// Redis connection configuration
const getRedisConnection = () => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const url = new URL(redisUrl);

  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    username: url.username || undefined,
  };
};

declare const Buffer: {
  from(data: string, encoding: string): { toString(encoding: string): string };
};

/**
 * POST /api/tests/[id]/execute
 * Execute a single test (both Playwright and k6 performance tests)
 */
type ExecuteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: ExecuteContext) {
  try {
    const { project, organizationId } = await requireProjectContext();
    const params = await context.params;
    const testId = params.id;

    // Check permission
    const canExecute = await hasPermission('test', 'execute', {
      organizationId,
      projectId: project.id,
    });

    if (!canExecute) {
      return NextResponse.json(
        { error: 'Insufficient permissions to execute tests' },
        { status: 403 }
      );
    }

    // Fetch test
    const test = await db.query.tests.findFirst({
      where: eq(tests.id, testId),
    });

    if (!test) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 });
    }

    // Verify test belongs to the current project
    if (test.projectId !== project.id || test.organizationId !== organizationId) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 });
    }

    // Parse request body for location (k6 tests only)
    const normalizeLocation = (value?: string): K6Location => {
      if (value === 'us-east' || value === 'eu-central' || value === 'asia-pacific') {
        return value;
      }
      return 'us-east';
    };

    let requestedLocation: string | undefined;
    try {
      const body = await request.json();
      requestedLocation = typeof body.location === 'string' ? body.location : undefined;
    } catch {
      // Body might be empty, use default
    }

    const resolvedLocation: K6Location = normalizeLocation(requestedLocation);

    // Validate k6 script if it's a performance test
    if (test.type === 'performance') {
      try {
        const decodedScript = Buffer.from(test.script, 'base64').toString('utf-8');
        const validation = validateK6Script(decodedScript);

        if (!validation.valid) {
          return NextResponse.json(
            {
              error: 'Invalid k6 script',
              details: validation.errors,
              warnings: validation.warnings,
            },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: 'Failed to validate k6 script' },
          { status: 400 }
        );
      }
    }

    // Create run record
    const runId = randomUUID();
    const [run] = await db.insert(runs).values({
      id: runId,
      jobId: null, // Single test execution has no job
      projectId: project.id,
      status: 'running',
      trigger: 'manual',
      location: test.type === 'performance' ? resolvedLocation : null,
      metadata: {
        source: 'playground',
        testId: test.id,
        testType: test.type,
        location: test.type === 'performance' ? resolvedLocation : undefined,
      },
      startedAt: new Date(),
    }).returning();

    // Decode script
    const decodedScript = Buffer.from(test.script, 'base64').toString('utf-8');

    // Enqueue based on test type
    const redisConnection = getRedisConnection();

    if (test.type === 'performance') {
      // K6 execution queue
      const k6Queue = new Queue('k6-execution', { connection: redisConnection });

      await k6Queue.add('k6-single-test-execution', {
        runId: run.id,
        jobId: null,
        testId: test.id,
        script: decodedScript,
        tests: [
          {
            id: test.id,
            script: decodedScript,
          },
        ],
        organizationId: test.organizationId,
        projectId: test.projectId,
        location: resolvedLocation,
      });

      await k6Queue.close();
    } else {
      // Playwright execution queue
      const playwrightQueue = new Queue('test-execution', {
        connection: redisConnection,
      });

      await playwrightQueue.add('playwright-single-test-execution', {
        runId: run.id,
        testId: test.id,
        script: decodedScript,
        organizationId: test.organizationId,
        projectId: test.projectId,
      });

      await playwrightQueue.close();
    }

    return NextResponse.json({
      runId: run.id,
      status: 'running',
      testType: test.type,
      location: test.type === 'performance' ? resolvedLocation : undefined,
    });
  } catch (error) {
    console.error('Error executing test:', error);
    return NextResponse.json(
      { error: 'Failed to execute test' },
      { status: 500 }
    );
  }
}
