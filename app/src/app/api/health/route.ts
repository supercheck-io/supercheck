import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { sql } from 'drizzle-orm';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

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

  // Check S3/MinIO connectivity (optional - only if configured)
  const s3Endpoint = process.env.S3_ENDPOINT;
  if (s3Endpoint) {
    try {
      const s3Start = Date.now();
      // Authenticated HeadBucket: proves the endpoint, credentials and path-style
      // addressing work. A bare HEAD / is not portable (MinIO answers 403, RustFS 501).
      const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        endpoint: s3Endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
        },
      });
      const bucket = process.env.S3_TEST_BUCKET_NAME || 'playwright-test-artifacts';

      try {
        await s3Client.send(new HeadBucketCommand({ Bucket: bucket }), {
          abortSignal: AbortSignal.timeout(5000),
        });
      } catch (error) {
        // The worker creates buckets on startup, so a missing bucket still means
        // the storage backend answered and accepted our credentials.
        const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404) {
          throw new Error('S3 endpoint not reachable or credentials rejected');
        }
      } finally {
        s3Client.destroy();
      }
      checks.s3 = { status: 'ok', latencyMs: Date.now() - s3Start };
    } catch (error) {
      checks.s3 = { 
        status: 'error', 
        error: error instanceof Error ? error.message : 'S3 connection failed' 
      };
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
