import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { sql } from 'drizzle-orm';

/**
 * Deep health check endpoint
 * 
 * Checks connectivity to critical infrastructure:
 * - Database (PostgreSQL)
 * - Redis (via BullMQ queues) - optional, only if REDIS_HOST is configured
 * - S3/MinIO - optional, only if S3_ENDPOINT is configured
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
      // Simple HTTP check to S3 endpoint (HEAD request to check availability)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(s3Endpoint, {
        method: 'HEAD',
        signal: controller.signal,
      }).catch(() => null);
      
      clearTimeout(timeoutId);
      
      if (response && (response.ok || response.status === 403 || response.status === 400)) {
        // 403/400 is expected for unauthenticated requests - endpoint is reachable
        checks.s3 = { status: 'ok', latencyMs: Date.now() - s3Start };
      } else {
        throw new Error('S3 endpoint not reachable');
      }
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
    timestamp: new Date().toISOString(),
    latencyMs: totalLatencyMs,
    checks,
  };

  // Return 503 if unhealthy, 200 otherwise (even if degraded)
  const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;
  
  return NextResponse.json(responseBody, { status: httpStatus });
}