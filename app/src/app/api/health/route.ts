import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { sql } from 'drizzle-orm';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

type S3Check = { status: 'ok' | 'error'; latencyMs?: number; error?: string };

// The route is public and the probe is signed with real credentials, so share one
// in-flight probe and reuse the result briefly instead of hitting storage per request.
const S3_CHECK_TTL_MS = 8000;
let s3CheckCache: { at: number; result: S3Check } | null = null;
let s3CheckInflight: Promise<S3Check> | null = null;

function getS3Check(): Promise<S3Check> {
  if (s3CheckCache && Date.now() - s3CheckCache.at < S3_CHECK_TTL_MS) {
    // latencyMs belongs to the original probe, so it is not repeated on cache hits.
    return Promise.resolve({ status: s3CheckCache.result.status, error: s3CheckCache.result.error });
  }
  s3CheckInflight ??= probeS3()
    .catch((): S3Check => ({ status: 'error', error: 'S3 connection failed' }))
    .then((result) => {
      s3CheckCache = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      s3CheckInflight = null;
    });
  return s3CheckInflight;
}

async function probeS3(): Promise<S3Check> {
  const start = Date.now();
  // Authenticated HeadBucket: proves the endpoint, credentials and path-style
  // addressing work. A bare HEAD / is not portable (MinIO answers 403, RustFS 501).
  const client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    maxAttempts: 1, // keep latency and error reporting predictable inside the 5s budget
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
    },
  });
  const bucket = process.env.S3_TEST_BUCKET_NAME || 'playwright-test-artifacts';

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }), {
      abortSignal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number; requestId?: string } } | null;
    // HEAD responses have no body, so the SDK reports any bodiless 404 as NotFound. Only
    // trust it as "storage answered" when the response carries an S3 request id; the worker
    // creates buckets at startup, so a missing bucket is otherwise fine.
    const bucketMissing = (err?.name === 'NotFound' || err?.name === 'NoSuchBucket') && !!err.$metadata?.requestId;
    if (!bucketMissing) {
      // Name and status only: raw SDK messages can include the endpoint host.
      const status = err?.$metadata?.httpStatusCode;
      return {
        status: 'error',
        error: `S3 probe failed: ${err?.name ?? 'UnknownError'}${status ? ` (${status})` : ''}`,
      };
    }
  } finally {
    client.destroy();
  }
  return { status: 'ok', latencyMs: Date.now() - start };
}

/**
 * Deep health check endpoint
 * 
 * Checks connectivity to critical infrastructure:
 * - Database (PostgreSQL)
 * - Redis (via BullMQ queues) - optional, only if REDIS_HOST is configured
 * - S3-compatible storage - optional, only if S3_ENDPOINT is configured
 * 
 * Returns:
 * - 200 OK: All required services are healthy
 * - 503 Service Unavailable: One or more required services are unhealthy
 */
export async function GET() {
  const startTime = Date.now();
  const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; error?: string }> = {};
  let overallStatus: 'ok' | 'degraded' | 'unhealthy' = 'ok';

  // Check Database connectivity
  try {
    const dbStart = Date.now();
    await db.execute(sql`SELECT 1`);
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (error) {
    checks.database = { 
      status: 'error', 
      error: error instanceof Error ? error.message : 'Database connection failed' 
    };
    overallStatus = 'unhealthy';
  }

  // Check Redis connectivity (optional - only if configured)
  const redisHost = process.env.REDIS_HOST;
  if (redisHost) {
    try {
      const redisStart = Date.now();
      // Reuse existing Redis connection from queue module to avoid connection leak
      // Previously created new connection every 30s which caused overhead
      const { getRedisConnection } = await import('@/lib/queue');
      const redis = await getRedisConnection();
      
      if (!redis) {
        throw new Error('Redis connection is not initialized');
      }

      await redis.ping();
      // Don't quit - reuse the connection pool
      checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
    } catch (error) {
      checks.redis = { 
        status: 'error', 
        error: error instanceof Error ? error.message : 'Redis connection failed' 
      };
      // Redis failure degrades but doesn't make unhealthy (queues can recover)
      if (overallStatus === 'ok') overallStatus = 'degraded';
    }
  }

  // Check S3-compatible storage connectivity (optional - only if configured)
  if (process.env.S3_ENDPOINT) {
    try {
      checks.s3 = await getS3Check();
      if (checks.s3.status === 'error' && overallStatus === 'ok') overallStatus = 'degraded';
    } catch {
      checks.s3 = { status: 'error', error: 'S3 connection failed' };
      // S3 failure degrades but doesn't make unhealthy (reports can be retried)
      if (overallStatus === 'ok') overallStatus = 'degraded';
    }
  }

  const totalLatencyMs = Date.now() - startTime;

  const responseBody = {
    status: overallStatus,
    build: {
      revision: process.env.SUPERCHECK_BUILD_SHA || "unknown",
    },
    timestamp: new Date().toISOString(),
    latencyMs: totalLatencyMs,
    checks,
  };

  // Return 503 if unhealthy, 200 otherwise (even if degraded)
  const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;
  
  return NextResponse.json(responseBody, { status: httpStatus });
}
