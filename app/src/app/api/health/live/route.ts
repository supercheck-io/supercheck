import { NextResponse } from 'next/server';

/**
 * Lightweight liveness check endpoint
 * 
 * Returns:
 * - 200 OK: Service is running (alive)
 * 
 * Used by K8s LivenessProbe to prevent unnecessary restarts during 
 * downstream dependency failures (DB/Redis outages).
 */
export async function GET() {
  return NextResponse.json({ status: 'alive' }, { status: 200 });
}
