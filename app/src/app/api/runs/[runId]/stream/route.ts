import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { runs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireProjectContext } from '@/lib/project-context';
import { hasPermission } from '@/lib/rbac/middleware';
import { Redis } from 'ioredis';

/**
 * GET /api/runs/[runId]/stream
 * Server-Sent Events endpoint for real-time console streaming
 * Streams console output from k6 (and potentially Playwright) test executions
 */
type RunStreamContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(request: NextRequest, context: RunStreamContext) {
  try {
    const { project, organizationId } = await requireProjectContext();
    const params = await context.params;
    const runId = params.runId;

    // Check permission
    const canView = await hasPermission('test', 'view', {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Verify run exists and belongs to this project
    const run = await db.query.runs.findFirst({
      where: eq(runs.id, runId),
    });

    if (!run) {
      return new Response('Run not found', { status: 404 });
    }

    if (run.projectId !== project.id) {
      return new Response('Run not found', { status: 404 });
    }

    // Create Redis client for pub/sub
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redis = new Redis(redisUrl);

    // Create a ReadableStream for SSE
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const subscriber = redis.duplicate();
        let closed = false;
        let heartbeat: NodeJS.Timeout | null = null;
        let completionCheck: NodeJS.Timeout | null = null;

        const shutdown = async () => {
          if (closed) return;
          closed = true;

          if (heartbeat) clearInterval(heartbeat);
          if (completionCheck) clearInterval(completionCheck);

          subscriber.removeAllListeners('message');

          try {
            await subscriber.unsubscribe();
          } catch (error) {
            console.error('SSE unsubscribe error:', error);
          }

          try {
            await subscriber.quit();
          } catch (error) {
            console.error('SSE subscriber quit error:', error);
          }

          try {
            await redis.quit();
          } catch (error) {
            console.error('SSE redis quit error:', error);
          }

          try {
            controller.close();
          } catch (error) {
            console.error('SSE controller close error:', error);
          }
        };

        const safeEnqueue = (payload: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(payload));
          } catch (error) {
            console.error('SSE enqueue failed:', error);
            void shutdown();
          }
        };

        // Subscribe to console output channel
        await subscriber.subscribe(`k6:run:${runId}:console`, (err) => {
          if (err) {
            console.error('Redis subscription error:', err);
            controller.error(err);
            void shutdown();
            return;
          }
        });

        const handleMessage = (_channel: string, message: string) => {
          safeEnqueue(`event: console\ndata: ${JSON.stringify({ line: message })}\n\n`);
        };

        subscriber.on('message', handleMessage);

        // Heartbeat every 30 seconds to keep connection alive
        heartbeat = setInterval(() => {
          safeEnqueue(': heartbeat\n\n');
        }, 30000);

        // Check for completion every 2 seconds
        completionCheck = setInterval(async () => {
          if (closed) {
            return;
          }

          try {
            const currentRun = await db.query.runs.findFirst({
              where: eq(runs.id, runId),
            });

            if (currentRun && currentRun.status !== 'running') {
              safeEnqueue(
                `event: complete\ndata: ${JSON.stringify({ status: currentRun.status })}\n\n`,
              );

              await shutdown();
            }
          } catch (error) {
            console.error('Error checking run status:', error);
          }
        }, 2000);

        // Cleanup on connection close
        request.signal.addEventListener('abort', () => {
          void shutdown();
        });
      },
    });

    // Return SSE response
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable buffering in nginx
      },
    });
  } catch (error) {
    console.error('Error setting up SSE stream:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
