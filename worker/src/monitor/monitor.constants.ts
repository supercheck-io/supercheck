/**
 * Monitor Queue Constants
 *
 * CRITICAL: Queue names must match exactly across all components:
 * - App queue definitions in app/src/lib/queue.ts
 * - Scheduler constants in worker/src/scheduler/constants.ts
 * - KEDA ScaledObjects in deploy/k8s/keda-scaledobject.yaml
 *
 * Architecture:
 * - Monitors MUST run in their specified location for accurate latency data
 * - Each regional worker processes ONLY its regional queue
 * - No global/fallback queue — location accuracy is critical
 * - Queue names are dynamic: `monitor-{locationCode}` (from DB locations table)
 */

// Job name used when adding monitor jobs to queues
export const EXECUTE_MONITOR_JOB_NAME = 'executeMonitorJob';

/** Build a monitor queue name from a location code */
export function monitorQueueName(locationCode: string): string {
  return `monitor-${locationCode}`;
}

// Worker location from environment (optional - only set in production)
export const WORKER_LOCATION = process.env.WORKER_LOCATION || undefined;
