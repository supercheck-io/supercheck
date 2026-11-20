import { NextResponse } from 'next/server';
import { isConsumerHealthy } from '@/lib/consumer-watchdog';

/**
 * Lightweight liveness check endpoint
 *
 * Returns:
 * - 200 OK: Service is running (alive)
 * - 503: a BullMQ consumer (scheduler, status-page, deletion, capacity events) has been stuck for
 *   minutes after a Redis failover and cannot recover by itself, so Kubernetes restarts the pod.
 *
 * A Redis or DB outage alone never fails this probe: consumers that ioredis is still reconnecting
 * are not counted.
 */
export async function GET() {
  if (!isConsumerHealthy()) {
    return NextResponse.json({ status: 'unhealthy', reason: 'queue consumer stalled' }, { status: 503 });
  }
  return NextResponse.json({ status: 'alive' }, { status: 200 });
}
