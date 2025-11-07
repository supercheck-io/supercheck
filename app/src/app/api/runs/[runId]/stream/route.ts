import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { runs, projects } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireProjectContext } from '@/lib/project-context';
import { hasPermission } from '@/lib/rbac/middleware';
import { getRedisConnection, buildRedisOptions } from '@/lib/queue';
import { createLogger } from '@/lib/logger/index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Create SSE stream logger
const sseLogger = createLogger({ module: 'sse-stream' }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

/**
 * GET /api/runs/[runId]/stream
 * Server-Sent Events endpoint for real-time console streaming
 * Streams console output from k6 (and potentially Playwright) test executions
 */
type RunStreamContext = {
  params: Promise<{ runId: string }>;
};

const encoder = new TextEncoder();

const parseInterval = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const HEARTBEAT_INTERVAL_MS = parseInterval(
  process.env.SSE_HEARTBEAT_INTERVAL_MS,
  15000,
);
const STATUS_POLL_INTERVAL_MS = parseInterval(
  process.env.SSE_STATUS_POLL_INTERVAL_MS,
  3000,
);
const RETRY_MS = parseInterval(process.env.SSE_RETRY_MS, 4000);

export async function GET(request: NextRequest, context: RunStreamContext) {
  try {
    const { project, organizationId } = await requireProjectContext();
    const params = await context.params;
    const runId = params.runId;

    // Verify run exists and load owning org/project
    const runRecord = await db
      .select({
        id: runs.id,
        projectId: runs.projectId,
        status: runs.status,
        orgId: projects.organizationId,
      })
      .from(runs)
      .leftJoin(projects, eq(projects.id, runs.projectId))
      .where(eq(runs.id, runId))
      .limit(1);

    const run = runRecord[0];

    if (!run) {
      return new Response('Run not found', { status: 404 });
    }

    const targetOrgId = run.orgId ?? organizationId;
    const targetProjectId = run.projectId ?? project.id;

    const canView = await hasPermission('test', 'view', {
      organizationId: targetOrgId,
      projectId: targetProjectId,
    });

    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    let finalizeStream: ((reason: string) => Promise<void>) | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        const baseRedis = await getRedisConnection();
        const subscriber = baseRedis.duplicate({
          ...buildRedisOptions({
            lazyConnect: true,
          }),
        });
        subscriber.setMaxListeners(0);

        const channel = `k6:run:${runId}:console`;
        let closed = false;
        let heartbeatTimer: NodeJS.Timeout | null = null;
        let statusPollTimeout: NodeJS.Timeout | null = null;

        const safeEnqueue = (payload: string) => {
          if (closed) {
            return;
          }
          try {
            controller.enqueue(encoder.encode(payload));
          } catch (error) {
            sseLogger.error({ err: error, runId }, 'SSE enqueue failed');
            void shutdown('enqueue_failed');
          }
        };

        const sendJsonEvent = (event: string, data: Record<string, unknown>) => {
          safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        const clearTimers = () => {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
          if (statusPollTimeout) {
            clearTimeout(statusPollTimeout);
            statusPollTimeout = null;
          }
        };

        const shutdown = async (reason: string) => {
          if (closed) {
            return;
          }
          closed = true;

          clearTimers();
          request.signal.removeEventListener('abort', handleAbort);
          subscriber.off('message', handleMessage);
          subscriber.off('error', handleRedisError);
          subscriber.off('end', handleRedisDisconnect);
          subscriber.off('close', handleRedisDisconnect);

          try {
            await subscriber.unsubscribe(channel);
          } catch (error) {
            sseLogger.error({ err: error, runId }, 'SSE unsubscribe error');
          }

          try {
            await subscriber.quit();
          } catch (error) {
            sseLogger.error({ err: error, runId }, 'SSE subscriber quit error');
          }

          const shouldCloseController = !['client_abort', 'stream_cancelled'].includes(reason);
          if (shouldCloseController) {
            try {
              controller.close();
            } catch (error) {
              sseLogger.error({ err: error, runId }, 'SSE controller close error');
            }
          } else {
            sseLogger.debug({ runId, reason }, 'Skipping controller.close due to client cancellation');
          }

          sseLogger.debug({ runId, reason }, 'SSE stream shutdown');
        };

        finalizeStream = shutdown;

        const handleAbort = () => {
          sseLogger.debug({ runId }, 'SSE request aborted by client');
          void shutdown('client_abort');
        };

        const handleRedisError = (error: Error) => {
          if (closed) return;
          sseLogger.error({ err: error, runId }, 'Redis subscriber error');
          sendJsonEvent('error', { message: 'Redis subscriber error' });
          void shutdown('redis_error');
        };

        const handleRedisDisconnect = () => {
          if (closed) return;
          sseLogger.warn({ runId }, 'Redis subscriber connection closed');
          sendJsonEvent('error', { message: 'Redis subscriber connection closed' });
          void shutdown('redis_disconnect');
        };

        const handleMessage = (_channel: string, message: string) => {
          sendJsonEvent('console', { line: message });
        };

        const ensureConnected = async () => {
          if (subscriber.status === 'ready') {
            return;
          }
          if (subscriber.status === 'end' || subscriber.status === 'wait') {
            await subscriber.connect();
            return;
          }
          if (subscriber.status === 'connecting') {
            await new Promise<void>((resolve, reject) => {
              const cleanup = () => {
                subscriber.off('ready', onReady);
                subscriber.off('error', onError);
              };
              const onReady = () => {
                cleanup();
                resolve();
              };
              const onError = (err: Error) => {
                cleanup();
                reject(err);
              };
              subscriber.once('ready', onReady);
              subscriber.once('error', onError);
            });
            return;
          }
          await subscriber.connect();
        };

        try {
          await ensureConnected();
        } catch (error) {
          sseLogger.error({ err: error, runId }, 'Redis connect error');
          sendJsonEvent('error', { message: 'Unable to connect to Redis' });
          await shutdown('redis_connect_failed');
          return;
        }

        subscriber.on('message', handleMessage);
        subscriber.on('error', handleRedisError);
        subscriber.on('end', handleRedisDisconnect);
        subscriber.on('close', handleRedisDisconnect);

        try {
          await subscriber.subscribe(channel);
        } catch (error) {
          sseLogger.error({ err: error, runId }, 'Redis subscription error');
          sendJsonEvent('error', { message: 'Unable to subscribe to run logs' });
          await shutdown('subscribe_failed');
          return;
        }

        request.signal.addEventListener('abort', handleAbort);

        safeEnqueue(`retry: ${RETRY_MS}\n\n`);
        sendJsonEvent('ready', { runId });

        heartbeatTimer = setInterval(() => {
          sendJsonEvent('heartbeat', { ts: Date.now() });
        }, HEARTBEAT_INTERVAL_MS);

        const pollRunStatus = async () => {
          if (closed) {
            return;
          }

          try {
            const currentRun = await db.query.runs.findFirst({
              where: eq(runs.id, runId),
            });

            if (!currentRun) {
              sendJsonEvent('complete', { status: 'not_found' });
              await shutdown('run_missing');
              return;
            }

            if (currentRun.status !== 'running') {
              sendJsonEvent('complete', { status: currentRun.status });
              await shutdown('completed');
              return;
            }
          } catch (error) {
            sseLogger.error({ err: error, runId }, 'Error checking run status');
          }

          statusPollTimeout = setTimeout(pollRunStatus, STATUS_POLL_INTERVAL_MS);
        };

        statusPollTimeout = setTimeout(pollRunStatus, STATUS_POLL_INTERVAL_MS);
      },
      async cancel() {
        if (finalizeStream) {
          await finalizeStream('stream_cancelled');
        }
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
    sseLogger.error({ err: error }, 'Error setting up SSE stream');
    return new Response('Internal server error', { status: 500 });
  }
}
