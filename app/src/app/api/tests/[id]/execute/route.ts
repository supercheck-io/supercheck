import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { tests, runs, type K6Location } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';
import {
  addK6TestToQueue,
  addTestToQueue,
  K6ExecutionTask,
  TestExecutionTask,
} from '@/lib/queue';
import { validateK6Script } from '@/lib/k6-validator';
import { randomUUID } from 'crypto';
import { SubscriptionService } from '@/lib/services/subscription-service';

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

    // Check subscription plan limits
    const subscriptionService = new SubscriptionService();
    try {
      await subscriptionService.getOrganizationPlan(organizationId);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Subscription required' },
        { status: 402 }
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
      const lower = value?.toLowerCase();
      // Accept kebab-case format matching K6Location type: "us-east" | "eu-central" | "asia-pacific" | "global"
      if (lower === "us-east" || lower === "eu-central" || lower === "asia-pacific" || lower === "global") {
        return lower;
      }
      // Default to global for any other value with warning
      console.warn(`[LOCATION WARNING] Invalid location "${value}" received, defaulting to "global". Valid locations: us-east, eu-central, asia-pacific, global`);
      return "global";
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
    if (test.type === 'performance') {
      const k6Task: K6ExecutionTask = {
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
        organizationId: test.organizationId ?? "",
        projectId: test.projectId ?? "",
        location: resolvedLocation,
      };

      await addK6TestToQueue(k6Task, 'k6-single-test-execution');
    } else {
      const playwrightTask: TestExecutionTask = {
        testId: test.id,
        code: decodedScript,
        runId: run.id,
        organizationId: test.organizationId ?? "",
        projectId: test.projectId ?? "",
      };

      await addTestToQueue(playwrightTask);
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
